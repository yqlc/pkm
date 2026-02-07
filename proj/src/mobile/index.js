const { default: createLogger } = require('../utils/logger');
const config = require('../config/default');
const dayjs = require('dayjs');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const { createBrowserInstance } = require('../puppeteer/utils');
const { default: getCurrentIpInfo } = require('../puppeteer/ipinfo');
const { triggerSendRegisterEmail, continueRegister } = require('../puppeteer/register');
const { sleep } = require('../utils');

const logger = createLogger('MOBILE');

let stopped = true;

async function start() {
  logger.info('修改手机号模块启动');

  while (stopped === false) {
    try {

    } catch (err) {
      logger.error(`失败: ${err.message}`);
    }

    // 等待 60 秒后再次检查
    await sleep(60_000);
  }
}

//#region 账号注册
let isProcessingAccounts = false;

// 检查账号是否已在队列中
function isAccountInQueue(account) {
  return registerAccounts.some(acc => acc.account === account);
}

async function getValidRegisterUrl(account) {
  // 从主进程获取数据库中是否已收到最新的注册链接
  try {
    const checkNewestUrlPromise = new Promise((resolve) => {
    // 发送请求获取最新注册链接
      let timeoutId;
      const handleResponse = (msg) => {
        if (msg.type === 'NEWEST_REGISTER_URL_RESPONSE') {
          clearTimeout(timeoutId);
          process.removeListener('message', handleResponse);
          resolve(msg.data?.url);
        }
      };

      process.on('message', handleResponse);

      // 设置短超时，如果主进程没有响应，继续等待邮箱
      timeoutId = setTimeout(() => {
        process.removeListener('message', handleResponse);
        resolve(null); // 超时则返回 null
      }, 10_000); // 10秒超时

      process.send({
        type: 'GET_NEWEST_REGISTER_URL',
        data: {
          account: account
        }
      });
    });

    return await checkNewestUrlPromise;
  } catch {
    return null;
  }
}

async function waitForRegisterEmail(browser, accountData) {
  // 监听邮箱中的注册邮件
  try {
    const registerEventPromise = new Promise((resolve, reject) => {
      let timeoutId;
      const handleMessage = (msg) => {
        if (msg.type === 'REGISTER_EVENT'
            && msg.data?.account === accountData.account) {

          // 清除超时定时器
          clearTimeout(timeoutId);
          process.removeListener('message', handleMessage);

          if (msg.data?.registered) {
            resolve(true);
          } else if (msg.data?.url) {
            resolve(msg.data.url);
          } else {
            reject(new Error('REGISTER_EVENT 事件数据无效'));
          }
        }
      };

      timeoutId = setTimeout(() => {
        // 在超时情况下也要移除事件监听器
        process.removeListener('message', handleMessage);
        reject(new Error('等待 REGISTER_EVENT 事件超时'));
      }, config.register.timeOfListemRegisterUrl * 60 * 1000); // 60分钟超时

      process.on('message', handleMessage);
    });

    return await registerEventPromise;
  } catch (error) {
    throw error;
  }
}

async function actualRegisterLogic(accountData) {
  logger.info(`开始处理账号: ${accountData.account}`);

  let browser;
  try {
    browser = await createBrowserInstance(accountData);

    // 使用 Puppeteer 获取当前 IP 所在地域
    const ipInfo = await getCurrentIpInfo(browser);

    if (ipInfo.country !== 'JP') {
      throw new Error(`IP地址 ${ipInfo.ip} 不在日本，当前地区: ${ipInfo.region}, ${ipInfo.country}, ${ipInfo.city}`);
    }

    logger.debug(`当前IP地址: ${ipInfo.ip}, 所在地区: ${ipInfo.region}, ${ipInfo.country}, ${ipInfo.city}`);

    // 是日本ip，继续操作
    const registerUrl = await getValidRegisterUrl(accountData.account);
    // 注册链接是否有效
    if (registerUrl) {
      logger.info(`从数据库获取到最新的注册链接: ${registerUrl}`);

      // 继续后续注册流程
      await continueRegister(browser, logger, registerUrl, accountData);
    } else {
      // 触发发送注册邮件
      const pokemonPage = await triggerSendRegisterEmail(browser, logger, accountData);

      // 等待注册邮件到达
      const newRegisterUrl = await waitForRegisterEmail(browser, accountData);
      if (newRegisterUrl === true) {
        await pokemonPage.close();
        logger.info('该邮箱已注册过了');
        return;
      }

      if (!newRegisterUrl) {
        throw new Error('注册链接接收超时');
      }

      logger.info(`收到注册链接: ${newRegisterUrl}`);

      // 随机处理界面关闭
      const closeRandomly = Math.random() > 0.5;
      if (closeRandomly && pokemonPage) {
        await pokemonPage.close();
      }

      // 继续后续注册流程
      await continueRegister(browser, logger, newRegisterUrl, accountData);
    }
  } catch (error) {
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

//#endregion

// IPC
process.on('message', (msg) => {
  switch (msg.type) {
  case 'START':
    if (stopped) {
      stopped = false;

      start();
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
