const path = require('path');
const { fork } = require('child_process');
const { Account, EmailLog } = require('../database');

async function startModifyMobileWorker(eventBus, logger) {
  eventBus = eventBus || require('../app').eventBus;
  logger = logger || require('../utils/logger').mainLogger;

  const workerPath = path.join(__dirname, '../mobile/index.js');
  const modifyWorker = fork(workerPath);

  // 启动子进程
  modifyWorker.send({ type: 'START' });

  // 监听子进程消息
  modifyWorker.on('message', async (msg) => {
    switch (msg.type) {
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

  eventBus.on('MODIFY_MOBILE_EVENT', (taskData) => {
    if (taskData) {
      switch (taskData.type) {
      case 'task_created':
        // modifyWorker.send({
        //   type: 'MODIFY_MOBILE_EVENT',
        //   data: {
        //     taskId: taskData.taskId,
        //     phone: taskData.phone
        //   }
        // });
        break;
      case 'task_submitted':
        break;
      default:
        break;
      }
    }
  });
};

module.exports = {
  __esModule: true,
  default: startModifyMobileWorker,
};
