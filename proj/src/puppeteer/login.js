const { createBrowserPage, simulatePageInput, simulatePageClick } = require('./utils');
const { sleep } = require('../utils');

async function waitForLogin(process, browser, logger, accountData) {

  // 新建页面并打开 Pokemon Center 网站
  const pokemonPage = await createBrowserPage(browser);

  await pokemonPage.goto('https://www.pokemoncenter-online.com/login/', { waitUntil: 'networkidle2', timeout: 60_000 });

  logger.info('已打开 Pokemon Center 网站');

  await pokemonPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, Math.random() * 40);

  await simulatePageInput(pokemonPage, '#login-form-email', accountData.account, Math.random() * 80);
  logger.info(`已输入账号: ${accountData.account}`);

  await pokemonPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, Math.random() * 10);

  await simulatePageInput(pokemonPage, '#current-password', accountData.account, Math.random() * 80);
  logger.info(`已输入密码: ${accountData.account}`);

  // 等待并点击登录按钮
  await simulatePageClick(pokemonPage, '#form1Button', Math.random() * 100);
  logger.info('已点击登录按钮');

  let isSuccess = false;
  const startTime = Date.now();
  const maxWaitTime = 60000; // 最大等待时间60秒
  while ((Date.now() - startTime) < maxWaitTime) {
    const currentUrl = pokemonPage.url();
    logger.info(`登录第一步监控URL: ${currentUrl}`);

    // 检查是否跳转到了mfa页面
    // https://www.pokemoncenter-online.com/login-mfa/?rurl=1
    const successPattern = /https:\/\/www\.pokemoncenter-online\.com\/login-mfa\/\?rurl=1/;
    if (successPattern.test(currentUrl)) {
      logger.info('检测到MFA页面，登录第一步完成');

      isSuccess = true;
      break; // 结束当前流程
    }

    // 检查界面中是否存在 comErrorBox 节点
    try {
      const errorText = await pokemonPage.evaluate(() => {
        const errorBox = document.querySelector('.comErrorBox');
        if (errorBox) {
          return errorBox.textContent.trim();
        }
        return null;
      });

      if (errorText) {
        // 抛出异常，结束当前流程
        const checkError = new Error(`登录页面错误: ${errorText}`);
        checkError.name = 'PkmCheckError';
        throw checkError;
      }
    } catch (err) {
      if (err.name === 'PkmCheckError') {
        logger.warn(err.message);
      } else {
        logger.warn(`检查登录页是否包含错误信息时出现问题: ${err.message}`);
      }

      throw err;
    }

    // 等待一段时间后再检查
    await sleep(1_000); // 等待1秒
  }

  if (!isSuccess) {
    logger.info('等待登录第一步超时，页面仍未跳转到预期URL');

    const timeoutError = new Error('登录提交后，页面跳转检测超时');
    timeoutError.name = 'TimeoutError';
    throw timeoutError;
  }

  // 等待页面跳转
  await pokemonPage.waitForNavigation({ timeout: 30_000 });
  await sleep(1_000); // 等待1秒

  const mfaCode = await waitForMfaCodeEmail(process, accountData);
  await sleep(1_000);

  // 登录并返回页面
  return await waitForMfaVerify(browser, pokemonPage, logger, mfaCode); // 结束当前流程
};

async function waitForMfaVerify(browser, pokemonPage, logger, mfaCode) {
  await pokemonPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, Math.random() * 10);

  await simulatePageInput(pokemonPage, '#authCode', mfaCode, Math.random() * 80);
  logger.info(`已输入MFA验证码: ${mfaCode}`);

  // await pokemonPage.evaluate((scrollValue) => {
  //   window.scrollBy(0, scrollValue);
  // }, Math.random() * 100);

  await simulatePageClick(pokemonPage, '#authBtn', Math.random() * 100);
  logger.info('已点击验证按钮');

  let isSuccess = false;
  const startTime = Date.now();
  const maxWaitTime = 60000; // 最大等待时间60秒
  while ((Date.now() - startTime) < maxWaitTime) {
    const currentUrl = pokemonPage.url();
    logger.info(`登录MFA监控URL: ${currentUrl}`);

    // 检查是否跳转到了用户主页
    // https://www.pokemoncenter-online.com/mypage/
    const successPattern = /https:\/\/www\.pokemoncenter-online\.com\/mypage/;
    if (successPattern.test(currentUrl)) {
      logger.info('检测到用户主页面，登录完成');

      isSuccess = true;
      break;  // 结束当前流程
    }

    // 检查界面中是否存在 comErrorBox 节点
    try {
      const errorText = await pokemonPage.evaluate(() => {
        const errorBox = document.querySelector('.comErrorBox');
        if (errorBox) {
          return errorBox.textContent.trim();
        }
        return null;
      });

      if (errorText) {
        // 抛出异常，结束当前流程
        const checkError = new Error(`登录(MFA)页面错误: ${errorText}`);
        checkError.name = 'PkmCheckError';
        throw checkError;
      }
    } catch (err) {
      if (err.name === 'PkmCheckError') {
        logger.warn(err.message);
      } else {
        logger.warn(`检查登录MFA页是否包含错误信息时出现问题: ${err.message}`);
      }

      throw err;
    }

    // 等待一段时间后再检查
    await sleep(1_000); // 等待1秒
  }

  if (!isSuccess) {
    logger.info('等待登录MFA超时，页面未跳转到预期URL');

    const timeoutError = new Error('登录(MFA)验证后，页面跳转检测超时');
    timeoutError.name = 'TimeoutError';
    throw timeoutError;
  }

  // 等待页面跳转
  await pokemonPage.waitForNavigation({ timeout: 30_000 });
  await sleep(1_000); // 等待1秒

  return pokemonPage;
}

async function waitForMfaCodeEmail(process, accountData) {
  // 监听邮箱中的注册邮件
  try {
    const ipcPromise = new Promise((resolve, reject) => {
      let timeoutId;
      const handleMessage = (msg) => {
        if (msg.type === 'LOGIN_VERIFY_EVENT'
            && msg.data?.account === accountData.account) {

          // 清除超时定时器
          clearTimeout(timeoutId);
          process.removeListener('message', handleMessage);

          if (msg.data?.mfaCode) {
            resolve(msg.data.mfaCode);
          } else {
            reject(new Error('LOGIN_VERIFY_EVENT 事件数据无效'));
          }
        }
      };

      timeoutId = setTimeout(() => {
        // 在超时情况下也要移除事件监听器
        process.removeListener('message', handleMessage);
        reject(new Error('等待 LOGIN_VERIFY_EVENT 事件超时'));
      }, config.register.timeOfListemMfaCode * 60 * 1000); // 5分钟超时

      process.on('message', handleMessage);
    });

    return await ipcPromise;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  __esModule: true,
  waitForLogin,
};
