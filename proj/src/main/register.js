const path = require('path');
const { fork } = require('child_process');
const config = require('../config/default');
const { Account } = require('../database');

async function startRegisterWorker(eventBus, logger) {
  eventBus = eventBus || require('../app').eventBus;
  logger = logger || require('../utils/logger').mainLogger;

  const workerPath = path.join(__dirname, '../register/index.js');
  const registerWorker = fork(workerPath);

  // 发送初始配置给子进程
  const filePath = path.resolve(config.register.excelFilePath);
  registerWorker.send({ type: 'START', filePath: filePath });

  // 监听子进程消息
  registerWorker.on('message', async (msg) => {
    if (msg.type === 'FIND_ACCOUNTS') {
      const accounts = msg.accounts;

      // 写入数据库
      try {
        const result = await Account.bulkCreate(accounts, {
          ignoreDuplicates: true
        });
        logger.info(`成功将 ${result.length} 条账户记录写入数据库`);
      } catch (err) {
        logger.error(`写入数据库失败: ${err.message}`);
      }

      // 读取需注册的账号，发送给注册子进程
      sendRegisterEvent(registerWorker, logger);
    }
  });

  // 守护进程：子进程挂了自动重启
  registerWorker.on('exit', (code) => {
    if (code !== 0) {
      logger.error(`注册子进程异常退出 (Code ${code})，3秒后重启...`);
      setTimeout(() => {
        startRegisterWorker();
      }, 3000);
    }
  });

  eventBus.on('EMAIL_EVENT', (emailData) => {
    if (emailData && emailData.result && emailData.result.type === 'register_url') {
      // 这里可以根据 emailData 内容决定是否发送给注册子进程
      registerWorker.send({ type: 'REGISTER_EVENT', data: emailData });
    }
  });

  // 读取需注册的账号，发送给注册子进程
  await sendRegisterEvent(registerWorker, logger);
}

async function sendRegisterEvent(registerWorker, logger) {
  try {
    const pendingAccounts = await Account.findAll({ where: { registered: false } });
    if (pendingAccounts.length > 0) {
      registerWorker.send({ type: 'PENDING_ACCOUNTS', accounts: pendingAccounts });
      logger.info(`发送 ${pendingAccounts.length} 条未完成注册的账号给注册子进程`);
    }
  } catch (err) {
    logger.error(`发送注册事件失败: ${err.message}`);
  }
}

module.exports = {
  __esModule: true,
  default: startRegisterWorker,
};
