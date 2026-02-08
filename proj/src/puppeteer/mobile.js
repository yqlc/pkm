const { createBrowserPage, waitForNextOperation, simulatePageClick, simulatePageInput, simulatePageSelect } = require('./utils');
const { waitForLogin } = require('./login');
const { sleep } = require('../utils');

async function modifyAccountMobile(page, logger, accountData, phone) {

  await page.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, Math.random() * 40);

  return page;
}

async function submitAccountMobileCaptcha(page, logger, accountData, captcha) {
  // await simulatePageInput(page, logger, '#mobileCaptcha', captcha);
}

async function checkAccountMobileStatus(page, logger, accountData) {
  // await simulatePageInput(page, logger, '#mobileCaptcha', captcha);

  sleep(20_000_000);
}

module.exports = {
  __esModule: true,
  modifyAccountMobile,
  submitAccountMobileCaptcha,
  checkAccountMobileStatus
};
