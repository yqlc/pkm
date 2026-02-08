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

  // 等待页面跳转
  await pokemonPage.waitForNavigation({ timeout: 30_000 });
  await sleep(1_000); // 等待1秒

  const startTime = Date.now();
  const maxWaitTime = 60000; // 最大等待时间60秒
  while ((Date.now() - startTime) < maxWaitTime) {
    const currentUrl = pokemonPage.url();
    logger.info(`登录流程监控URL: ${currentUrl}`);

    // 检查是否跳转到了mfa页面
    // https://www.pokemoncenter-online.com/login-mfa/?rurl=1
    const successPattern = /https:\/\/www\.pokemoncenter-online\.com\/login-mfa\/\?rurl=1/;
    if (successPattern.test(currentUrl)) {
      logger.info('检测到MFA页面，登录第一步完成');

      const mfaCode = await waitForMfaCodeEmail(process, accountData);

      await sleep(1_000);

      // 登录并返回页面
      return await waitForMfaVerify(browser, pokemonPage, logger, mfaCode); // 结束当前流程
    }

    // 检查界面中是否存在 comErrorBox 节点
    let errorText = null;
    try {
      errorText = await pokemonPage.evaluate(() => {
        const errorBox = document.querySelector('.comErrorBox');
        if (errorBox) {
          return errorBox.textContent.trim();
        }
        return null;
      });
    } catch (err) {
      logger.warn(`检查登录界面是否包含错误信息时出现问题: ${err.message}`);
    }

    if (errorText) {
      logger.info(`检测到登录错误信息: ${errorText}`);

      await pokemonPage.close();

      // 抛出异常，结束当前流程
      throw new Error(`登录页面错误: ${errorText}`);
    }

    // 等待一段时间后再检查
    await sleep(1_000); // 等待1秒
  }

  logger.info('超过最大等待时间，页面仍未跳转到预期URL');
  await pokemonPage.close();

  const timeoutError = new Error('登录第一步确认后，页面跳转检测超时');
  timeoutError.name = 'TimeoutError';
  throw timeoutError;
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

  // 等待页面跳转
  await pokemonPage.waitForNavigation({ timeout: 30_000 });
  await sleep(1_000); // 等待1秒

  const startTime = Date.now();
  const maxWaitTime = 60000; // 最大等待时间60秒
  while ((Date.now() - startTime) < maxWaitTime) {
    const currentUrl = pokemonPage.url();
    logger.info(`登录流程监控URL: ${currentUrl}`);

    // 检查是否跳转到了用户主页
    // https://www.pokemoncenter-online.com/mypage/
    const successPattern = /https:\/\/www\.pokemoncenter-online\.com\/mypage/;
    if (successPattern.test(currentUrl)) {
      logger.info('检测到用户主页面，登录完成');

      // 返回当前页面
      return pokemonPage; // 结束当前流程
    }

    // 检查界面中是否存在 comErrorBox 节点
    let errorText = null;
    try {
      errorText = await pokemonPage.evaluate(() => {
        const errorBox = document.querySelector('.comErrorBox');
        if (errorBox) {
          return errorBox.textContent.trim();
        }
        return null;
      });
    } catch (err) {
      logger.warn(`检查MFA登录界面是否包含错误信息时出现问题: ${err.message}`);
    }

    if (errorText) {
      logger.info(`检测到MFA登录错误信息: ${errorText}`);

      await pokemonPage.close();

      // 抛出异常，结束当前流程
      throw new Error(`登录页面(MFA)错误: ${errorText}`);
    }

    // 等待一段时间后再检查
    await sleep(1_000); // 等待1秒
  }

  logger.info('超过最大等待时间，页面仍未跳转到预期URL');
  await pokemonPage.close();

  const timeoutError = new Error('登录MFA验证后，页面跳转检测超时');
  timeoutError.name = 'TimeoutError';
  throw timeoutError;
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
