const { createBrowserPage } = require('./utils');

async function getCurrentIpInfo(browser) {
  const page = await createBrowserPage(browser);

  // 访问一个可以显示IP地理位置的服务
  await page.goto('https://ipinfo.io/json', { waitUntil: 'networkidle2' });

  // 获取页面内容
  const ipInfo = await page.evaluate(() => {
    return JSON.parse(document.body.textContent);
  });

  // 关闭当前页面
  await page.close();

  return ipInfo;
}

module.exports = {
  __esModule: true,
  default: getCurrentIpInfo,
};
