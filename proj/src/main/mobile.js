const path = require('path');
const { fork } = require('child_process');
const { Op } = require('sequelize');

const config = require('../config/default');
const { Account, CaptchaLog } = require('../database');


async function startModifyMobileWorker(eventBus, logger) {
  eventBus = eventBus || require('../app').eventBus;
  logger = logger || require('../utils/logger').mainLogger;

  const workerPath = path.join(__dirname, '../mobile/index.js');
  const modifyWorker = fork(workerPath);

  const concurrenceCount = config.tasks.mobile.concurrenceCount || 1;
  // 启动子进程
  modifyWorker.send({ type: 'START', concurrenceCount });

  // 监听子进程消息
  modifyWorker.on('message', async (msg) => {
    switch (msg.type) {
    case 'MODIFY_ACCOUNT_MOBILE_PREPARING':
      const { accounts, taskId } = msg.data || {};
      let account = null;

      // 构造查询条件
      const whereCondition = {
        status: 1,  // 已注册
        phone: null  // phone 为空
      };

      if (accounts && accounts.length) {
        // 如果 accounts 数组不为空，查询条件中需增加 account 不在 accounts 中
        whereCondition.account = { [Op.notIn]: accounts };
      }

      // 执行查询
      account = await Account.findOne({ where: whereCondition });

      if (account) {
        // TODO: 提前分配IP代理
        logger.info(`找到待修改手机号的账号: ${account.account}，任务ID: ${taskId}`);
      } else {
        logger.info(`未找到需要修改手机号的账号: ${taskId}`);
      }

      modifyWorker.send({ type: 'MODIFY_ACCOUNT_MOBILE_PREPARED', account: account });
      break;
    case 'MODIFY_ACCOUNT_MOBILE_COMPLETED':
      logger.info(`任务 ${msg.data.taskId} 执行成功`);
      const { taskId: completedTaskId, account: completedAccount, phone } = msg.data || {};
      // 更新账号中的手机号
      try {
        await Account.update({
          phone
        }, {
          where: { account: completedAccount }
        });
      } catch (e) {
        logger.error(`更新账号手机号失败: ${e.message}`);
      }

      // 更新验证码记录
      try {
        await CaptchaLog.update({
          status: 5,
          account: completedAccount,
          reason: 'Success'
        }, {
          where: { completedTaskId }
        });
      } catch (e) {
        logger.error(`更新验证码记录失败: ${e.message}`);
      }
      break;
    case 'MODIFY_ACCOUNT_MOBILE_UPDATE':
      logger.info(`任务 ${msg.data.taskId} 状态更新: ${msg.data.type}`);
      // 0: 待处理, 1: 正在处理, 2: 已发送, 3: 已接收, 4: 已提交, 5: 成功, 6: 失败
      try {
        const { taskId, account, type, message, error } = msg.data || {};
        const updateInfo = {};
        if (type === 'bind_acount') {
          updateInfo.account = account;
          updateInfo.status = 1;
          updateInfo.reason = null;
        } else if (type === 'failed') {
          updateInfo.status = 6;
          updateInfo.reason = message || 'Unknown';
        } else if (type === 'send') {
          updateInfo.status = 2;
          updateInfo.reason = 'Captcha sent';
        } else if (type === 'submit') {
          updateInfo.status = 4;
          updateInfo.reason = 'Captcha submitted';
        }

        if (updateInfo.status) {
          await CaptchaLog.update(updateInfo, {
            where: { taskId }
          });
        }
      } catch (e) {
        logger.error(`更新验证码记录失败: ${e.message}`);
      }
      break;
    default:
      break;
    }
  });

  // 守护进程：子进程挂了自动重启
  let mainAppShuttingDown = false;

  // 监听主进程退出信号
  process.on('SIGINT', () => {
    mainAppShuttingDown = true;
  });

  process.on('SIGTERM', () => {
    mainAppShuttingDown = true;
  });

  modifyWorker.on('exit', (code) => {
    if (mainAppShuttingDown) {
      logger.info('主进程正在退出，不重启修改手机号子进程');
      return;
    }

    if (code !== 0) {
      logger.error(`修改手机号子进程异常退出 (Code ${code})，3秒后重启...`);
      setTimeout(() => {
        startModifyMobileWorker(eventBus, logger);
      }, 3_000);
    }
  });

  eventBus.on('MAIN_APP_SHUTDOWN', () => {
    mainAppShuttingDown = true;
    logger.info('修改手机号子进程收到关闭信号，开始关闭...');
    if (!modifyWorker.connected) {
      logger.info('修改手机号子进程已关闭');
      return;
    }
    modifyWorker.send({ type: 'STOP' });
  });

  eventBus.on('MODIFY_MOBILE_EVENT', async (taskData) => {
    if (taskData) {
      modifyWorker.send({ type: 'MODIFY_MOBILE', data: taskData });
    }
  });

  eventBus.on('EMAIL_EVENT', (emailData) => {
    if (emailData && emailData.type === 'login_mfa_code') {
      modifyWorker.send({
        type: 'LOGIN_VERIFY_EVENT',
        data: {
          account: emailData.recipient,
          mfaCode: emailData.result
        }
      });
    }
  });
};

module.exports = {
  __esModule: true,
  default: startModifyMobileWorker,
};
