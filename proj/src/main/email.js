const path = require('path');
const { fork } = require('child_process');
const { EmailLog } = require('../database');

async function startEmailWorker(eventBus, logger, initialUid) {
  eventBus = eventBus || require('../app').eventBus;
  logger = logger || require('../utils/logger').mainLogger;

  const workerPath = path.join(__dirname, '../email/index.js');
  const emailWorker = fork(workerPath);

  // 发送初始UID给子进程
  emailWorker.send({ type: 'INIT_UID', uid: initialUid });

  // 监听子进程消息
  emailWorker.on('message', async (msg) => {
    if (msg.type === 'EMAIL_FOUND') {
      const emailData = msg.data;
      logger.info(`收到子进程邮件数据 - Type: ${emailData.type}, Result: ${emailData.result}`);

      // A. 写入数据库 (去重校验)
      try {
        await EmailLog.create({
          uid: emailData.uid,
          sender: emailData.sender,
          subject: emailData.subject,
          recipient: emailData.recipient,
          receiveDate: emailData.receiveDate,
          parsedType: emailData.type,
          parsedResult: emailData.result,
        });
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          logger.warn(`重复邮件 UID ${emailData.uid}，忽略`);
        } else {
          logger.error(`数据库写入失败: ${err.message}`);
        }
      }

      eventBus.emit('EMAIL_EVENT', emailData);
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

  emailWorker.on('exit', (code) => {
    if (mainAppShuttingDown) {
      logger.info('主进程正在退出，不重启邮箱子进程');
      return;
    }

    if (code !== 0) {
      logger.error(`邮箱子进程异常退出 (Code ${code})，3秒后重启...`);
      setTimeout(() => {
        // 重启时，重新获取最新的 UID
        EmailLog.findOne({ order: [['uid', 'DESC']] }).then(last => {
          startEmailWorker(eventBus, logger, last ? last.uid : 0);
        });
      }, 3_000);
    }
  });

  eventBus.on('MAIN_APP_SHUTDOWN', () => {
    mainAppShuttingDown = true;
    logger.info('邮箱子进程收到关闭信号，开始关闭...');
    if (!emailWorker.connected) {
      logger.info('邮箱子进程已关闭');
      return;
    }
    emailWorker.send({ type: 'STOP' });
  });
}

module.exports = {
  __esModule: true,
  default: startEmailWorker,
};
