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
      logger.info(`收到子进程邮件数据 - Code: ${emailData.code}, URL: ${!!emailData.url}`);

      // A. 写入数据库 (去重校验)
      try {
        await EmailLog.create({
          uid: emailData.uid,
          sender: emailData.sender,
          subject: emailData.subject,
          recipient: emailData.recipient,
          parsed_result: JSON.stringify(emailData.result),
        });

        // B. 广播事件 (供注册模块监听)
        eventBus.emit('EMAIL_EVENT', emailData);
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
          startEmailWorker(eventBus, logger, last ? last.uid : 0);
        });
      }, 3000);
    }
  });
}

module.exports = {
  __esModule: true,
  default: startEmailWorker,
};
