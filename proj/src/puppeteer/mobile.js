const { createBrowserPage, waitForNextOperation, simulatePageClick, simulatePageInput, simulatePageSelect } = require('./utils');
const { sleep } = require('../utils');

async function modifyAccountMobile(myPage, logger, accountData, phone) {
  // https://www.pokemoncenter-online.com/account-input/
  // <a href="javascript:void(0)" class="editProfile " data-imt-p="1">会員情報変更</a>
  await simulatePageClick(myPage, '.editProfile', Math.random() * 100);
  logger.info('已点击会员信息修改');

  // 等待页面跳转
  await myPage.waitForNavigation({ timeout: 30_000 }); // 等待页面跳转
  await sleep(1_000); // 等待1秒

  // 检查是否到达预期的确认页面
  const currentUrl = myPage.url();
  if (!currentUrl.includes('account-input')) {
    throw new Error(`会员信息未跳转到预期页面，当前URL: ${currentUrl}`);
  }

  // <input type="tel" class="js-validate telNumber form-control" autocomplete="tel" data-missing-error="電話番号は必須項目です。" data-range-error="電話番号は10 ～ 11文字で入力してください。" data-pattern-mismatch="登録できない電話番号です。正しい番号を再度入力してください。" aria-describedby="form-phone-error" placeholder="09012345678" name="dwfrm_profile_customer_phone" required="" aria-required="true" value="0900000000" maxlength="11" pattern="^0[0-9]{9,10}$" data-gtm-form-interact-field-id="0"></input>
  await simulatePageInput(myPage, 'input[name="dwfrm_profile_customer_phone"]', phone, Math.random() * 80);
  logger.info('已输入新电话号码');

  // <button type="submit" class="submitButton" data-imt-p="1">入力内容確認へ進む</button>
  await simulatePageClick(myPage, '.submitButton', Math.random() * 100);
  logger.info('已点击提交修改');

  // 检查错误信息
  let isSuccess = false;
  const startTime = Date.now();
  const maxWaitTime = 60000; // 最大等待时间60秒
  while ((Date.now() - startTime) < maxWaitTime) {
    const currentUrl = myPage.url();
    logger.info(`修改手机号监控确认页URL: ${currentUrl}`);

    // 检查是否跳转到了确认修改页
    // https://www.pokemoncenter-online.com/account-confirm/
    const successPattern = /https:\/\/www\.pokemoncenter-online\.com\/account-confirm/;
    if (successPattern.test(currentUrl)) {
      logger.info('修改手机号检测到确认修改页面，继续下一步');

      isSuccess = true;
      break;
    }

    // if (confirmUrl.includes('account-confirm')) {
    //   logger.info('修改手机号检测到确认修改页面，继续下一步');
    //   isSuccess = true;
    //   break;
    // }

    // <div class="errorLogErea"><div class="comErrorBox"><p data-imt-p="1">登録できない電話番号です。正しい番号を再度入力してください。</p></div></div>
    // 检查界面中 error-messaging 节点下是否有子节点
    try {
      const hasChildNodes = await registerPage.evaluate(() => {
        const errorDiv = document.querySelector('.errorLogErea');
        return errorDiv && errorDiv.children.length > 0;
      });

      if (hasChildNodes) {
        // 获取具体的错误信息
        const errorText = await registerPage.evaluate(() => {
          const errorDiv = document.querySelector('.errorLogErea');
          return errorDiv ? errorDiv.innerText.trim() : '';
        });

        const checkError = new Error(`修改手机号页面错误: ${errorText}`);
        checkError.name = 'PkmCheckError';
        throw checkError;
      }
    } catch (err) {
      if (err.name === 'PkmCheckError') {
        logger.warn(err.message);
      } else {
        logger.warn(`检查修改手机号页是否包含错误信息时出现问题: ${err.message}`);
      }

      throw err;
    }

    // 等待一段时间后再检查
    await sleep(1_000); // 等待1秒
  }

  if (!isSuccess) {
    logger.info('超过最大等待时间，页面仍未跳转到预期URL');

    const timeoutError = new Error('修改手机号填写后，页面跳转检测超时');
    timeoutError.name = 'TimeoutError';
    throw timeoutError;
  }

  // 等待页面加载完成
  await myPage.waitForNavigation({ timeout: 30_000 }); // 等待页面跳转
  await sleep(1_000); // 等待1秒

  // <button class="submitButton">登録する</button>
  await simulatePageClick(myPage, '.submitButton', Math.random() * 100);
  logger.info('已点击确认修改');

  // https://www.pokemoncenter-online.com/regist-complete/
  // 等待页面跳转
  await myPage.waitForNavigation({ timeout: 30_000 }); // 等待页面跳转
  await sleep(1_000); // 等待1秒

  // 检查是否到达预期的确认页面
  const completeUrl = myPage.url();
  if (!completeUrl.includes('regist-complete')) {
    throw new Error(`修改手机号确认后未跳转到预期页面，当前URL: ${completeUrl}`);
  }

  // 修改成功了，返回页面
  logger.info('修改手机号操作成功');

  let hasJumpToMyPage = false;
  try {
    const element = await myPage.waitForSelector('a.prepend_icon.-prev', {
      visible: true,
      timeout: 30000
    });
    // 如果找到了，继续处理
    const href = await element.evaluate(el => el.getAttribute('href'));

    const successPattern = /https:\/\/www\.pokemoncenter-online\.com\/mypage/;
    if (successPattern.test(href)) {
      // 模拟点击
      await element.click();

      await myPage.waitForNavigation({ timeout: 30_000 }); // 等待页面跳转
      await sleep(1_000); // 等待1秒

      // 检查是否到达预期的确认页面
      const finalUrl = myPage.url();
      if (!successPattern.test(finalUrl)) {
        logger.warn(`返回用户主页未跳转到预期页面，当前URL: ${finalUrl}`);
        throw new Error(`返回用户主页未跳转到预期页面，当前URL: ${finalUrl}`);
      } else {
        hasJumpToMyPage = true;
      }
    }
  } catch { }

  if (!hasJumpToMyPage) {
    await myPage.goto('https://www.pokemoncenter-online.com/mypage/', { waitUntil: 'networkidle2', timeout: 60_000 });
    logger.info('修改手机号后手动跳转用户主页');
  }

  return myPage;
}

async function submitAccountMobileCaptcha(myPage, logger, accountData, captcha) {
  // await simulatePageInput(page, logger, '#mobileCaptcha', captcha);
}

async function checkAccountMobileStatus(myPage, logger, accountData) {
  // await simulatePageInput(page, logger, '#mobileCaptcha', captcha);

  sleep(20_000_000);
}

async function verifyAccountMobile(myPage, logger, accountData, phone) {
  // https://www.pokemoncenter-online.com/auth-code-select/
  // <a href="javascript:void(0)" class="sendCertificationCodeShow ">電話番号認証</a>
  await simulatePageClick(myPage, '.sendCertificationCodeShow', Math.random() * 100);
  logger.info('已点击电话号码验证');

  // 等待页面跳转
  await myPage.waitForNavigation({ timeout: 30_000 }); // 等待页面跳转
  await sleep(1_000); // 等待1秒

  // 检查是否到达预期的确认页面
  const currentUrl = myPage.url();
  if (!currentUrl.includes('auth-code-select')) {
    throw new Error(`电话号码验证未跳转到预期页面，当前URL: ${currentUrl}`);
  }

  // <a href="#" class="sendCertificationCode1 prepend_icon -sms02" id="sms" name="smsSubmit" value="1" data-imt-p="1">SMSで認証コードを送信する</a>
  await simulatePageClick(myPage, '#sms', Math.random() * 100);

  // 等待页面跳转
  await myPage.waitForNavigation({ timeout: 30_000 }); // 等待页面跳转
  await sleep(1_000); // 等待1秒

  // https://www.pokemoncenter-online.com/error/
  const newPageUrl = myPage.url();
  const successPattern = /https:\/\/www\.pokemoncenter-online\.com\/error/;
  if (successPattern.test(newPageUrl)) {
    throw new Error(`电话号码验跳转到了错误页: ${newPageUrl}`);
  }

  // 正常应该是号码验证页面


}

module.exports = {
  __esModule: true,
  modifyAccountMobile,
  verifyAccountMobile,
  submitAccountMobileCaptcha,
  checkAccountMobileStatus
};
