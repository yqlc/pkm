const { createBrowserPage, waitForNextOperation, simulatePageClick, simulatePageInput, simulatePageSelect } = require('./utils');
const { sleep } = require('../utils');

async function triggerSendRegisterEmail(browser, logger, accountData) {
  // 新建页面并打开 Pokemon Center 网站
  const pokemonPage = await createBrowserPage(browser);

  await pokemonPage.goto('https://www.pokemoncenter-online.com/login/', { waitUntil: 'networkidle2', timeout: 60_000 });

  logger.info('已打开 Pokemon Center 网站');

  await pokemonPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, Math.random() * 40);

  await simulatePageInput(pokemonPage, '#login-form-regist-email', accountData.account, Math.random() * 80);
  logger.info(`已输入账号: ${accountData.account}`);

  // 等待并点击注册按钮
  await simulatePageClick(pokemonPage, '#form2Button', Math.random() * 100);
  logger.info('已点击注册按钮');

  // 等待页面跳转到确认页面
  await pokemonPage.waitForNavigation({ timeout: 60_000 }); // 等待页面跳转
  await sleep(1_000); // 等待1秒

  // 检查是否到达预期的确认页面
  const currentUrl = pokemonPage.url();
  if (!currentUrl.includes('temporary-customer-confirm')) {
    throw new Error(`未跳转到预期的确认页面，当前URL: ${currentUrl}`);
  }

  logger.info('已跳转到临时客户确认页面');

  // 等待页面元素加载
  await pokemonPage.waitForSelector('input[type="email"][name="email"]', { visible: true, timeout: 10_000 });

  // 获取邮箱输入框的值并验证
  const emailValue = await pokemonPage.$eval('input[type="email"][name="email"]', el => el.value);

  if (emailValue !== accountData.account) {
    throw new Error(`邮箱值不匹配，期望: ${accountData.account}, 实际: ${emailValue}`);
  }

  logger.info(`邮箱值验证成功: ${emailValue}`);

  await pokemonPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, Math.random() * 30);

  // 等待并点击发送确认邮件按钮
  // <a href="" id="send-confirmation-email">仮登録メールを送信する</a>
  await simulatePageClick(pokemonPage, '#send-confirmation-email', Math.random() * 100);

  // 等待 REGISTER_EVENT 事件触发
  logger.info('已点击发送确认邮件按钮，等待 REGISTER_EVENT 事件...');

  return pokemonPage;
}

function splitByBrackets(str) {
  // 匹配中文或英文括号
  const regex = /(.*?)[（(]([^）)]*)[）)]/;
  const match = str.match(regex);

  if (match) {
    return {
      mainText: match[1].trim(),
      bracketText: match[2].trim()
    };
  }

  return {
    mainText: str.trim(),
    bracketText: ''
  };
}

async function continueRegister(browser, logger, registerUrl, accountData) {
  // 随机等待一段时间，模拟人为操作
  const waitTime = Math.floor(Math.random() * 5_000) + 1_000;
  await sleep(waitTime);

  // 打开新的页面并访问注册链接
  const registerPage = await createBrowserPage(browser);
  await registerPage.goto(registerUrl, { waitUntil: 'networkidle2', timeout: 60_000 });

  logger.info(`已打开注册链接: ${registerUrl}`);

  // 检查是否被重定向到错误页面
  const currentUrl = registerPage.url();
  if (/https:\/\/www\.pokemoncenter-online\.com\/error.*message=error\.message\.account\.invalid.*/.test(currentUrl)) {
    throw new Error('注册链接已过期');
  }

  // 等待页面元素加载
  await registerPage.waitForSelector('body', { visible: true, timeout: 10_000 });

  // 等待并输入昵称
  const nnmae = accountData.romanName || '';
  await simulatePageInput(registerPage, '#registration-form-nname', nnmae, (Math.random() * 100) + 20);
  logger.info(`已输入昵称: ${nnmae}`);

  // 等待并输入姓名
  const fname = accountData.jpName || '';
  await simulatePageInput(registerPage, '#registration-form-fname', fname, (Math.random() * 100) + 20);
  logger.info(`已输入姓名: ${fname}`);

  // 等待并输入平假名
  const kana = accountData.fullwidthName || '';
  await simulatePageInput(registerPage, '#registration-form-kana', kana, (Math.random() * 100) + 20);
  logger.info(`已输入平假名: ${kana}`);

  // 处理生日信息
  if (accountData.birthday) {
    const birthday = new Date(accountData.birthday);
    const year = birthday.getFullYear();
    const month = String(birthday.getMonth() + 1).padStart(2, '0'); // 月份从0开始，需要加1
    const day = String(birthday.getDate()).padStart(2, '0');

    // 选择年份
    await simulatePageSelect(registerPage, '#registration-form-birthdayyear', String(year), (Math.random() * 100) + 20);
    logger.info(`已选择出生年份: ${year}`);

    // 选择月份
    await simulatePageSelect(registerPage, '#registration-form-birthdaymonth', month, (Math.random() * 100) + 20);
    logger.info(`已选择出生月份: ${month}`);

    // 选择日期
    await simulatePageSelect(registerPage, '#registration-form-birthdayday', day, (Math.random() * 100) + 20);
    logger.info(`已选择出生日期: ${day}`);
  }

  await waitForNextOperation();

  await registerPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, (Math.random() * 100) + 200);

  await waitForNextOperation();

  // 填写邮编
  const zipCode = accountData.zipCode || '';
  await simulatePageInput(registerPage, '#registration-form-postcode', zipCode, (Math.random() * 100) + 20);
  logger.info(`已输入邮编: ${zipCode}`);

  await waitForNextOperation();

  await registerPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, (Math.random() * 100) + 100);

  await waitForNextOperation();

  const autoPrefecture = await registerPage.$eval('#registration-form-address-level1', el => el.value);
  const autoCity = await registerPage.$eval('#registration-form-address-level2', el => el.value);

  logger.info(`自动填充的都道府県: ${autoPrefecture}`);
  logger.info(`自动填充的市区町村: ${autoCity}`);

  await waitForNextOperation();

  // 填写地址信息
  // 市区町村 请输入全角12字符以内。（输入邮编后会自动填充）
  // const city = ''; //
  // await simulatePageInput(registerPage, '#registration-form-address-level2', city, (Math.random() * 100) + 20);
  // logger.info(`已输入市区町村: ${city}`);

  /*
  // 番地（门牌号）请输入全角16字符以内。如果地址中没有门牌号，请输入“番地なし”。
  const houseNumber = '番地なし';
  await simulatePageInput(registerPage, '#registration-form-address-line1', houseNumber, (Math.random() * 100) + 20);
  logger.info(`已输入番地: ${houseNumber}`);
  */

  /*
  await waitForNextOperation();

  // 建物名・部屋番号（可选） 请输入16个全角字符以内。
  const building = ''; // コーポウエダ201（d2293)
  await simulatePageInput(registerPage, '#registration-form-address-line2', building, (Math.random() * 100) + 20);
  logger.info(`已输入建物名・部屋番号: ${building}`);
  */

  const address = accountData.address || '';
  const { mainText: prefecture, bracketText: building } = splitByBrackets(address);

  await simulatePageInput(registerPage, '#registration-form-address-line1', prefecture, (Math.random() * 100) + 20);
  logger.info(`已输入番地: ${prefecture}`);

  await waitForNextOperation();

  await simulatePageInput(registerPage, '#registration-form-address-line2', building, (Math.random() * 100) + 20);
  logger.info(`已输入建物名・部屋番号: ${building}`);

  // 联系电话 请输入半角数字、“-”符号以内14字符。
  const phone = accountData.phone || '0900000000';
  await simulatePageInput(registerPage, 'input[name="dwfrm_profile_customer_phone"]', phone, (Math.random() * 100) + 20);
  logger.info(`已输入联系电话: ${phone}`);

  // 填写密码 请使用至少3种半角英数字及符号，且长度至少为8个字符来创建密码。
  const password = accountData.password;
  if (!password || password.length < 8) {
    throw new Error('密码长度不足8位');
  }
  await simulatePageInput(registerPage, 'input[name="dwfrm_profile_login_password"]', password, (Math.random() * 100) + 20);
  logger.info(`已输入密码: ${password}`);

  await simulatePageInput(registerPage, 'input[name="dwfrm_profile_login_passwordconfirm"]', password, (Math.random() * 100) + 20);
  logger.info(`已输入确认密码: ${password}`);

  await waitForNextOperation();

  await registerPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, (Math.random() * 100) + 100);

  await waitForNextOperation();

  // 勾选协议
  await registerPage.waitForSelector('#terms', { visible: true, timeout: 10_000 });
  await waitForNextOperation();
  if (!(await registerPage.$eval('#terms', el => el.checked))) {
    await registerPage.click('#terms');
    logger.info('已勾选条款协议');
  }

  await registerPage.waitForSelector('#privacyPolicy', { visible: true, timeout: 10_000 });
  await waitForNextOperation();
  if (!(await registerPage.$eval('#privacyPolicy', el => el.checked))) {
    await registerPage.click('#privacyPolicy');
    logger.info('已勾选隐私政策');
  }

  await waitForNextOperation();

  await registerPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, (Math.random() * 50) + 20);

  // <button id="registration_button" type="submit" class="btn btn-block btn-primary" data-imt-p="1" data-imt-translation-only="1">进入输入内容确认</button>
  // 注册按钮
  await simulatePageClick(registerPage, '#registration_button', Math.random() * 100);

  // 等待页面跳转
  await registerPage.waitForNavigation({ timeout: 30_000 });
  await sleep(1_000); // 等待1秒

  // 检查页面跳转是否符合成功条件，页面跳转不是立即发生的，需要等待并持续监控页面URL
  const startTime = Date.now();
  const maxWaitTime = 60000; // 最大等待时间60秒
  while ((Date.now() - startTime) < maxWaitTime) {
    const currentUrl = registerPage.url();
    logger.info(`监控页面URL: ${currentUrl}`);

    // 检查是否跳转到了成功确认页面
    const successPattern = /https:\/\/www\.pokemoncenter-online\.com\/new-customer-confirm\/\?rurl=1/;
    if (successPattern.test(currentUrl)) {
      logger.info('检测到注册成功确认页面，注册流程完成');
      // 关闭页面
      await registerPage.close();
      return; // 结束当前流程
    }

    // 检查界面中 error-messaging 节点下是否有子节点
    try {
      const hasChildNodes = await registerPage.evaluate(() => {
        const errorDiv = document.querySelector('.error-messaging');
        return errorDiv && errorDiv.children.length > 0;
      });

      if (hasChildNodes) {
        // 获取具体的错误信息
        const errorText = await registerPage.evaluate(() => {
          const errorDiv = document.querySelector('.error-messaging');
          return errorDiv ? errorDiv.innerText.trim() : '';
        });

        logger.info(`检测到错误信息: ${errorText}`);

        // 抛出异常，结束当前流程
        throw new Error(`注册信息填写页面错误: ${errorText}`);
      }
    } catch (err) {
      logger.warn(`检查注册是否包含错误信息时出现问题: ${err.message}`);

      await registerPage.close();

      // 注册过程中出现错误，关闭页面并抛出异常
      throw err;
    }

    // 等待一段时间后再检查
    await sleep(1_000); // 等待1秒
  }

  logger.info('超过最大等待时间，页面仍未跳转到预期URL');
  await registerPage.close();

  const timeoutError = new Error('完成注册信息填写，后页面跳转检测超时');
  timeoutError.name = 'TimeoutError';
  throw timeoutError;
}

module.exports = {
  __esModule: true,
  triggerSendRegisterEmail,
  continueRegister,
};
