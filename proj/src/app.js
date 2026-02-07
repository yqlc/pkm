const { EventEmitter } = require('events');
const { mainLogger } = require('./utils/logger');
const { sequelize, EmailLog } = require('./database');
const { default: startEmailWorker } = require('./main/email');
const { default: startRegisterWorker } = require('./main/register');
const { default: startExpressService } = require('./main/service');

const eventBus = new EventEmitter();

// 统一的资源清理函数
async function cleanupAndExit(exitCode) {
  try {
    mainLogger.info('开始清理资源...');

    // 尝试关闭数据库连接
    await sequelize.close();
    mainLogger.info('数据库已关闭');

    // 尝试关闭 Express 服务器
    if (global.expressApp && global.expressApp.startedServer) {
      try {
        await new Promise((resolve, reject) => {
          global.expressApp.startedServer.close((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        mainLogger.info('Express 服务器已关闭');
      } catch (serverErr) {
        mainLogger.error(`关闭 Express 服务器时出错: ${serverErr.message}`);
      }
    }

    mainLogger.info('资源清理完成');
  } catch (err) {
    mainLogger.error(`清理资源时出错: ${err.message}`);
  } finally {
    process.exit(exitCode);
  }
}

async function initSystem() {
  try {
    // 先配置key
    // await sequelize.query(`PRAGMA key = '${config.db.encryptionKey}';`);
    await sequelize.authenticate();
    // 同步数据库结构
    await sequelize.sync(); // 生产环境建议用 Migrations，这里简化为 sync

    mainLogger.info('数据库已连接并同步');

    // 2. 启动邮箱子进程，获取最后一次处理的邮件UID，用于断点续传
    const lastLog = await EmailLog.findOne({ order: [['uid', 'DESC']] });
    const lastUid = lastLog ? lastLog.uid : 0;
    startEmailWorker(eventBus, mainLogger, lastUid);

    // 3. 启动注册子进程
    startRegisterWorker(eventBus, mainLogger);

    // 4. 启动 Express 服务
    startExpressService(eventBus, mainLogger);

    mainLogger.info('系统初始化完成，等待任务...');

  } catch (err) {
    mainLogger.error(`系统启动失败: ${err.message}`);
    process.exit(1);
  }
}

// 处理未捕获异常，防止进程意外崩溃
process.on('uncaughtException', async (err) => {
  mainLogger.error(`未捕获异常: ${err.message}\n${err.stack}`);
  // 由于 uncaughtException 会使应用程序处于不确定状态，通常建议退出进程
  await cleanupAndExit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  mainLogger.error(`未处理 Promise 拒绝: ${reason}\nPromise: ${promise}`);
  // 退出进程以防止潜在的问题
  await cleanupAndExit(1);
});

// 监听进程退出信号，确保优雅关闭
process.on('SIGINT', async () => {
  mainLogger.info('收到 SIGINT 信号');
  await cleanupAndExit(0);
});

process.on('SIGTERM', async () => {
  mainLogger.info('收到 SIGTERM 信号');
  await cleanupAndExit(0);
});

// 启动
initSystem();

module.exports = { eventBus }; // 导出供其他模块使用
