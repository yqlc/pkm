const path = require('path');
const { fork } = require('child_process');
const config = require('../config/default');
const { Account, EmailLog } = require('../database');

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
    switch (msg.type) {
    case 'FIND_ACCOUNTS':
      const accounts = msg.accounts;

      // 写入数据库
      try {
        // 使用 bulkCreate 的 updateOnDuplicate 选项，实现 upsert 功能
        await Account.bulkCreate(accounts, {
          updateOnDuplicate: ['fingerprintId', 'password', 'phone', 'birthday', 'jpName', 'fullwidthName', 'romanName', 'zipCode', 'address', 'status', 'reason'], // 需要更新的字段
          validate: true
        });

        // 然后专门处理状态为2的账号，将其状态改为0并清空reason
        const accountNames = accounts.map(acc => acc.account);
        await Account.update(
          { status: 0, reason: null },
          {
            where: {
              account: accountNames,
              status: 2  // 只更新状态为2的账号
            }
          }
        );

        logger.info(`成功处理 ${accounts.length} 条账户记录`);
      } catch (err) {
        logger.error(`处理账户记录失败: ${err.message}`);
      }

      // 读取需注册的账号，发送给注册子进程
      sendRegisterEvent(registerWorker, logger);
      break;
    case 'REGISTER_COMPLETE':
      // 3s 后读取需注册的账号，发送给注册子进程
      setTimeout(() => {
        sendRegisterEvent(registerWorker, logger);
      }, 3000);
      break;
    case 'REGISTER_ACCOUNT_ERROR':
      // 处理账号注册错误，将错误信息写入数据库 Account
      try {
        const { account, reason, status } = msg.data;
        await Account.update(
          {
            reason: reason,
            status: status
          },
          { where: { account: account } }
        );
        logger.info(`账号 ${account} 注册失败，错误信息已保存到数据库`);
      } catch (err) {
        logger.error(`更新账号错误信息失败: ${err.message}`);
      }
      break;
    case 'GET_NEWEST_REGISTER_URL':
      let data = null;
      try {
        const { account } = msg.data;
        // 从 EmailLogs 表中读取最新账号的注册信息
        const latestEmailLog = await EmailLog.findOne({
          where: {
            recipient: account,
            parsedType: 'register_url'
          },
          order: [['createdAt', 'DESC']]
        });

        if (latestEmailLog && latestEmailLog.parsedResult) {
          // 检查邮件接收时间是否在60分钟内
          const now = new Date();
          const emailTime = new Date(latestEmailLog.receiveDate);
          const timeDiffInMinutes = (now - emailTime) / (1000 * 60);

          if (timeDiffInMinutes <= config.register.timeOfRegisterUrlInMail) { // 60分钟内
            data = {
              url: latestEmailLog.parsedResult,
            };
          }
        }
      } catch (err) {
        logger.error(`获取最新注册链接失败: ${err.message}`);
      }

      registerWorker.send({
        type: 'NEWEST_REGISTER_URL_RESPONSE',
        data: data
      });
      break;
    default:
      break;
    }
  });

  // 守护进程：子进程挂了自动重启
  let registerShuttingDown = false;

  // 监听主进程退出信号
  process.on('SIGINT', () => {
    registerShuttingDown = true;
  });

  process.on('SIGTERM', () => {
    registerShuttingDown = true;
  });

  registerWorker.on('exit', (code) => {
    if (registerShuttingDown) {
      logger.info('主进程正在退出，不重启注册子进程');
      return;
    }

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
    const pendingAccounts = await Account.findAll({ where: { status: 0 } }); // 状态为0表示新导入，需要注册
    if (pendingAccounts.length > 0) {
      // TODO: 提前分配IP代理
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
