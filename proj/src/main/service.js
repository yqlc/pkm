
// 从数据库模块导入 CaptchaLog 模型
const { CaptchaLog } = require('../database');
const { default: createLogger } = require('../utils/logger');
const { generateUniqueId } = require('../utils/index');

const reqLogger = createLogger('REQUEST');

function requestLoggingMiddleware(req, res, next) {
  // 记录请求开始时间
  const start = Date.now();

  // 收集请求信息
  const requestInfo = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    headers: {
      'user-agent': req.headers['user-agent'],
      referer: req.headers.referer,
    },
    params: req.params,
    query: req.query,
  };

  // 排除日志记录的路由 (如静态资源)
  const excludedRoutes = ['/favicon.ico'];
  if (excludedRoutes.includes(req.path)) {
    return next();
  }

  // 安全考虑，记录但不记录敏感信息
  if (req.headers.authorization) {
    requestInfo.headers.authorization = 'Bearer ***';
  }

  // 记录请求信息
  reqLogger.info('Incoming request', requestInfo);

  // 响应完成后的日志记录
  res.on('finish', () => {
    const duration = Date.now() - start;

    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('Content-Length') || 0,
    };

    if (res.statusCode >= 400) {
      reqLogger.warn('Request completed with error', logData);
    } else {
      reqLogger.info('Request completed', logData);
    }
  });

  next();
}

async function startExpressService(eventBus, logger) {
  // 确保只创建一个 Express 实例（单例模式）
  if (!global.expressApp) {
    const express = require('express');
    const cors = require('cors');
    const helmet = require('helmet');
    const config = require('../config/default');

    global.expressApp = express();
    const app = global.expressApp;
    const port = config.service.port || 8080;

    // 使用请求日志中间件
    app.use(requestLoggingMiddleware);

    // 安全中间件
    app.use(helmet());
    app.use(cors({
      origin: '*',
      credentials: true,
    }));

    // 应用全局中间件
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 开启任务接口
    app.post('/api/modphone/start', async (req, res) => {
      const { phone } = req.body || {};

      if (!phone) {
        return res.status(200).json({
          code: 0,
          msg: 'Phone number is required!',
          data: null
        });
      }

      try {
        let taskId;
        let insertSuccess = false;

        // 循环生成 taskId 直到成功插入数据库
        while (!insertSuccess) {
          taskId = generateUniqueId();

          try {
            // 尝试插入数据库
            await CaptchaLog.create({
              taskId: taskId,
              phone: phone,
              status: 0, // 待处理
            });

            // 插入成功，跳出循环
            insertSuccess = true;
          } catch (dbError) {
            if (dbError.name === 'SequelizeUniqueConstraintError') {
              // 如果是唯一约束错误，继续循环重新生成 taskId
              logger.info(`taskId ${taskId} 已存在，重新生成...`);
              continue;
            } else {
              // 其他数据库错误，抛出异常
              throw dbError;
            }
          }
        }

        logger.info(`创建新任务: taskId=${taskId}, phone=${phone}`);

        // 返回唯一标识
        res.status(200).json({
          code: 1,
          msg: 'OK',
          data: { taskId }
        });

        eventBus.emit(MODIFY_MOBILE_EVENT, { type: 'task_created', taskId, phone });
      } catch (error) {
        logger.error(`创建任务时出错: ${error.message}`);
        res.status(500).json({
          code: 0,
          msg: 'Server Internal Error!',
          data: null
        });
      }
    });

    // 接收验证码并返回任务状态接口
    app.post('/api/modphone/:taskId/submit-code', async (req, res) => {
      const { taskId } = req.params;
      const { captcha } = req.body || {};

      if (!captcha) {
        return res.status(200).json({
          code: 0,
          msg: 'Captcha is required!',
          data: null
        });
      }

      try {
        // 从 CaptchaLog 查询对应记录
        const captchaRecord = await CaptchaLog.findOne({ where: { taskId } });

        if (!captchaRecord) {
          return res.status(200).json({
            code: 0,
            msg: 'Task not found!',
            data: null
          });
        }

        // 更新数据库中的验证码和状态
        await captchaRecord.update({
          captcha,
          status: 3, // 已接收
          reason: '验证码已接收'
        });

        eventBus.emit(MODIFY_MOBILE_EVENT, { type: 'task_submitted', taskId, captcha });

        logger.info(`验证码已接收: taskId=${taskId}, captcha=***`);

        res.status(200).json({
          code: 1,
          msg: 'OK',
          data: null
        });
      } catch (error) {
        logger.error(`提交验证码时出错: ${error.message}`);
        res.status(500).json({
          code: 0,
          msg: 'Server Internal Error!',
          data: null
        });
      }
    });

    // 查询验证码提交后的结果接口
    app.get('/api/modphone/:taskId/result', async (req, res) => {
      const { taskId } = req.params;

      try {
        // 从 CaptchaLog 查询对应记录
        const captchaRecord = await CaptchaLog.findOne({ where: { taskId } });

        if (!captchaRecord) {
          return res.status(200).json({
            code: 0,
            msg: 'Task not found!',
            data: null
          });
        }

        // 从数据库记录中获取状态和结果
        const resultData = {
          status: captchaRecord.status,
          result: captchaRecord.reason,
          completedAt: captchaRecord.updatedAt
        };

        // 返回任务结果
        res.status(200).json({
          code: 1,
          msg: 'OK',
          data: resultData
        });
      } catch (error) {
        logger.error(`查询任务结果时出错: ${error.message}`);
        res.status(500).json({
          code: 0,
          msg: 'Server Internal Error!',
          data: null
        });
      }
    });

    // 未定义的路由或method统一处理 '/:any(*)'
    app.all(/\/(.*)/, (req, res) => {
      res.status(404).json({
        code: 0,
        msg: 'Unsupported operation',
        data: null
      });
    });

    // 启动 Express 服务并保存服务器实例到全局变量，以便后续可以关闭
    global.expressApp.startedServer = app.listen(port, () => {
      logger.info(`服务启动在端口 ${port}`);
    });

    logger.info('Express 应用已创建并启动');
  } else {
    logger.info('Express 应用已存在，无需重复创建');
  }
}

module.exports = {
  __esModule: true,
  default: startExpressService
};
