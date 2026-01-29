const { fork } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const createLogger = require('./utils/logger');
const config = require('./config/default');
const { sequelize, EmailLog, Account } = require('./database');

const logger = createLogger('MAIN');
const eventBus = new EventEmitter();

// 处理未捕获异常，防止进程意外崩溃
process.on('uncaughtException', (err) => logger.error(`未捕获异常: ${err.message}`));
process.on('unhandledRejection', (reason) => logger.error(`未处理 Promise: ${reason}`));

async function initSystem() {
  try {
    // 先配置key
    // await sequelize.query(`PRAGMA key = '${config.db.encryptionKey}';`);
    await sequelize.authenticate();
    // 同步数据库结构
    await sequelize.sync(); // 生产环境建议用 Migrations，这里简化为 sync

    logger.info('数据库已连接并同步');

    // 2. 获取最后一次处理的邮件UID，用于断点续传
    const lastLog = await EmailLog.findOne({ order: [['uid', 'DESC']] });
    const lastUid = lastLog ? lastLog.uid : 0;

    // 3. 启动邮箱子进程
    startEmailWorker(lastUid);

    // 4. 初始化其他模块 (注册、Web等 - 暂时留空)
    startRegisterWorker();
    logger.info('系统初始化完成，等待任务...');

  } catch (err) {
    logger.error(`系统启动失败: ${err.message}`);
    process.exit(1);
  }
}

async function startEmailWorker(initialUid) {
  const workerPath = path.join(__dirname, 'email', 'index.js');
  const emailWorker = fork(workerPath);

  // 发送初始UID给子进程
  emailWorker.send({ type: 'INIT_UID', uid: initialUid });

  // 监听子进程消息
  emailWorker.on('message', async (msg) => {
    if (msg.type === 'EMAIL_FOUND') {
      const emailData = msg.data;
      logger.info(`收到子进程邮件数据 - Code: ${emailData.code}, URL: ${!!emailData.url}`);

      // A. 写入数据库 (去重校验)
      try {
        await EmailLog.create({
          uid: emailData.uid,
          sender: emailData.sender,
          subject: emailData.subject,
          parsed_code: emailData.code,
          parsed_url: emailData.url
        });

        // B. 广播事件 (供注册模块监听)
        // 事件名格式示例: 'EMAIL_EVENT:verify_code' 或 'EMAIL_EVENT:register_url'
        eventBus.emit('EMAIL_EVENT', emailData);

        // 如果你需要针对特定邮箱广播，以便 Puppeteer 等待：
        // eventBus.emit(`TARGET:${emailData.sender}`, emailData);

      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          logger.warn(`重复邮件 UID ${emailData.uid}，忽略`);
        } else {
          logger.error(`数据库写入失败: ${err.message}`);
        }
      }
    }
  });

  // 守护进程：子进程挂了自动重启
  emailWorker.on('exit', (code) => {
    if (code !== 0) {
      logger.error(`邮箱子进程异常退出 (Code ${code})，3秒后重启...`);
      setTimeout(() => {
        // 重启时，重新获取最新的 UID
        EmailLog.findOne({ order: [['uid', 'DESC']] }).then(last => {
          startEmailWorker(last ? last.uid : 0);
        });
      }, 3000);
    }
  });
}

async function startRegisterWorker() {
  const workerPath = path.join(__dirname, 'register', 'index.js');
  const registerWorker = fork(workerPath);

  // 发送初始UID给子进程
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

  // 查询未完成注册的账号，并发送给注册进程
  const pendingAccounts = await Account.findAll({ where: { registered: false } });
  if (pendingAccounts.length > 0) {
    registerWorker.send({ type: 'PENDING_ACCOUNTS', accounts: pendingAccounts });
    logger.info(`发送 ${pendingAccounts.length} 条未完成注册的账号给邮箱子进程`);
  }

  eventBus.on('EMAIL_EVENT', (emailData) => {
    // 这里可以根据 emailData 内容决定是否发送给注册子进程
    registerWorker.send({ type: 'EMAIL_EVENT', data: emailData });
  });
}

// 启动
initSystem();

module.exports = { eventBus }; // 导出供其他模块使用
