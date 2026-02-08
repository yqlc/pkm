const { default: createLogger } = require('../utils/logger');

const { createBrowserInstance } = require('../puppeteer/utils');
const { default: getCurrentIpInfo } = require('../puppeteer/ipinfo');
const { waitForLogin } = require('../puppeteer/login');
const { modifyAccountMobile, submitAccountMobileCaptcha, checkAccountMobileStatus } = require('../puppeteer/mobile');
const { sleep } = require('../utils');

const logger = createLogger('MOBILE');

let stopped = true;
let maxModifyTaskCount = 1;
const modifyTasks = new Map();

const MODIFY_TASK_STATUS = {
  PENDING: 0,
  PROCESSING: 1,
  COMPLETED: 2,
  FAILED: 3,
};

async function start() {
  logger.info('修改手机号模块启动');

  while (stopped === false) {
    try {
      if (modifyTasks.size > 0) {

        // 判断 status === 1 的任务数量是否超过 maxModifyTaskCount
        let pendingTaskCount = 0;
        let taskId = null; // 需要处理的任务id
        for (const task of modifyTasks.values()) {
          if (task.status === MODIFY_TASK_STATUS.PROCESSING) {
            pendingTaskCount++;
          }

          if (!taskId && task.status === MODIFY_TASK_STATUS.PENDING) {
            taskId = task.taskId;
          }
        }

        if (taskId && pendingTaskCount < maxModifyTaskCount) {
        // 更新任务状态为处理中
          const task = modifyTasks.get(taskId);
          task.status = MODIFY_TASK_STATUS.PROCESSING;
          scheduleModifyTask(task);
        }
      }
    } catch (err) {
      logger.error(`任务调度失败: ${err.message}`);
    }

    // 等待 5 秒
    await sleep(5_000);
  }
}

async function scheduleModifyTask(task) {
  // 执行修改手机号任务
  try {
    logger.info(`开始处理修改任务: ${task.taskId}`);
    task.status = MODIFY_TASK_STATUS.PROCESSING;
    task.message = '';

    // 获取账号
    let accountData = null;
    do {
      accountData = await getModifyMobileAccount(task.taskId);
      if (!accountData) {
        task.status = MODIFY_TASK_STATUS.FAILED;
        task.message = 'Cannot find available account';
        throw new Error('获取修改手机号账号失败');
      }
    } while ([...modifyTasks.values()].some(task => task.account === accountData.account));

    task.account = accountData.account;
    logger.info(`为手机号任务: ${task.taskId} 分配账号: ${accountData.account}`);

    process.send({
      type: 'MODIFY_ACCOUNT_MOBILE_UPDATE',
      data: {
        taskId: task.taskId,
        type: 'bind_acount',
        account: accountData.account,
      }
    });

    let browser;
    try {
      browser = await createBrowserInstance(accountData);

      // 使用 Puppeteer 获取当前 IP 所在地域
      const ipInfo = await getCurrentIpInfo(browser);

      if (ipInfo.country !== 'JP') {
        task.status = MODIFY_TASK_STATUS.FAILED;
        task.message = 'Current position lost';
        throw new Error(`IP地址 ${ipInfo.ip} 不在日本，当前地区: ${ipInfo.region}, ${ipInfo.country}, ${ipInfo.city}`);
      }

      logger.debug(`当前IP地址: ${ipInfo.ip}, 所在地区: ${ipInfo.region}, ${ipInfo.country}, ${ipInfo.city}`);

      // 是日本ip，继续操作
      let page = await waitForLogin(browser, logger, accountData);

      await sleep(200_000_000);

      page = await modifyAccountMobile(page, logger, accountData, task.phone);

      process.send({
        type: 'MODIFY_ACCOUNT_MOBILE_UPDATE',
        data: {
          taskId: task.taskId,
          type: 'send',
        }
      });

      // 等待提交验证码
      const captcha = await getSubmittedCaptcha(task.taskId);
      if (!captcha) {
        task.status = MODIFY_TASK_STATUS.FAILED;
        task.message = 'Cannot get captcha';
        throw new Error('获取验证码失败');
      }

      await submitAccountMobileCaptcha(page, logger, accountData, captcha);

      // 提交验证码
      process.send({
        type: 'MODIFY_ACCOUNT_MOBILE_UPDATE',
        data: {
          taskId: task.taskId,
          type: 'submit',
        }
      });

      // 检查界面状态，确定是否绑定成功
      await checkAccountMobileStatus(page, logger, accountData);

      // 更新任务状态为已完成
      task.status = MODIFY_TASK_STATUS.COMPLETED;
      task.message = '';

      // 通知主进程任务成功
      process.send({
        type: 'MODIFY_ACCOUNT_MOBILE_COMPLETED',
        data: {
          taskId: task.taskId,
          account: accountData.account,
          phone: task.phone,
        }
      });
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  } catch (err) {
    logger.error(`修改手机号任务 ${task.taskId} 执行失败: ${err.message}`);

    if (task.status !== MODIFY_TASK_STATUS.FAILED) {
      task.status = MODIFY_TASK_STATUS.FAILED;
      task.message = 'Task execution failed';
    }

    // 通知主进程任务失败
    process.send({
      type: 'MODIFY_ACCOUNT_MOBILE_UPDATE',
      data: {
        taskId: task.taskId,
        type: 'failed',
        message: task.message,
        error: err.message
      }
    });
  } finally {
    modifyTasks.delete(task.taskId);
  }
}

async function getModifyMobileAccount(taskId) {
  try {
    const accounts = [...modifyTasks.values()]
      .map(task => task.account)
      .filter(account => typeof account === 'string' && account.trim() !== '');
    const ipcPromise = new Promise((resolve) => {
      let timeoutId;
      const handleResponse = (msg) => {
        if (msg.type === 'MODIFY_ACCOUNT_MOBILE_PREPARED') {
          clearTimeout(timeoutId);
          process.removeListener('message', handleResponse);
          resolve(msg.account);
        }
      };

      process.on('message', handleResponse);

      // 设置短超时
      timeoutId = setTimeout(() => {
        process.removeListener('message', handleResponse);
        resolve(null); // 超时则返回 null
      }, 30_000); // 30秒超时

      process.send({
        type: 'MODIFY_ACCOUNT_MOBILE_PREPARING',
        data: {
          accounts: accounts,
          taskId: taskId,
        }
      });
    });

    return await ipcPromise;
  } catch {
    return null;
  }
}

async function getSubmittedCaptcha(taskId) {
  try {
    const accounts = [...modifyTasks.values()].flatMap(task => task.account);
    const ipcPromise = new Promise((resolve) => {
      let timeoutId;
      const handleResponse = (msg) => {
        if (msg.type === 'MODIFY_ACCOUNT_MOBILE_CHECKED') {
          clearTimeout(timeoutId);
          process.removeListener('message', handleResponse);
          resolve(msg.account);
        }
      };

      process.on('message', handleResponse);

      // 设置短超时
      timeoutId = setTimeout(() => {
        process.removeListener('message', handleResponse);
        resolve(null); // 超时则返回 null
      }, 60_000); // 60秒超时

      process.send({
        type: 'MODIFY_ACCOUNT_MOBILE_CHECKING',
        data: {
          accounts: accounts,
          taskId: taskId,
        }
      });
    });

    return await ipcPromise;
  } catch {
    return null;
  }
}

// IPC
process.on('message', (msg) => {
  switch (msg.type) {
  case 'START':
    maxModifyTaskCount = msg.concurrenceCount || 1;
    if (stopped) {
      stopped = false;

      start();
    }
    break;
  case 'MODIFY_MOBILE':
    if (msg.data?.type) {
      switch (msg.data.type) {
      case 'task_created':
        const { taskId, phone } = msg.data;
        if (!taskId || !phone) {
          logger.error('task_created 事件数据缺失 taskId 或 phone');
          break;
        }
        modifyTasks.set(taskId, {
          taskId,
          phone,
          status: MODIFY_TASK_STATUS.PENDING,
          message: ''
        });
        break;
      case 'task_submitted':
        const { taskId: submittedTaskId, captcha } = msg.data;
        if (!submittedTaskId || !captcha) {
          logger.error('task_submitted 事件数据缺失 taskId 或 captcha');
          break;
        }

        const task = modifyTasks.get(submittedTaskId);
        if (!task) {
          logger.error(`任务 ${submittedTaskId} 不存在`);
          break;
        }
        task.captcha = captcha;
        break;
      default:
        break;
      }
    }
    break;
  case 'STOP':
    handleSignal('STOP');
    break;
  }
});

async function handleSignal(signal) {
  logger.warn(`手机号子进程收到 ${signal} 信号，开始清理资源...`);
  stopped = true;
  process.exit(0);
}

const gracefulSignals = ['SIGTERM', 'SIGINT', 'SIGQUIT'];
gracefulSignals.forEach(signal => {
  process.on(signal, async () => {
    await handleSignal(signal);
  });
});
