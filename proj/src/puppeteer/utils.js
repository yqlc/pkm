const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const config = require('../config/default');
const { sleep } = require('../utils');

async function createBrowserInstance(accountData) {
  // 使用配置中的浏览器路径和缓存目录
  const cacheDirectory = path.join(config.browser?.userDataBaseDir || '', accountData.fingerprintId, 'userData');
  if (!fs.existsSync(cacheDirectory)) {
    fs.mkdirSync(cacheDirectory, { recursive: true });
  }

  // TODO: 检查浏览器指纹文件是否存在
  // eslint-disable-next-line no-unused-vars
  const fingerprintPath = path.join(config.browser?.fingerprintDir || '', `${accountData.fingerprintId}.enc`);
  // if (!fs.existsSync(fingerprintPath)) {
  //   throw new Error(`浏览器指纹文件 ${fingerprintPath} 不存在`);
  // }

  const browser = await puppeteer.launch({
    browser: 'chrome',
    executablePath: config.browser?.executablePath, // 从配置获取浏览器执行路径
    userDataDir: cacheDirectory, // 从配置获取缓存目录,
    headless: false, // 设为 true 可以无头模式运行
    ignoreDefaultArgs: [
      '--no-startup-window',
      '--disable-crash-reporter',
      '--disable-crashpad-for-testing',
      '--disable-gpu-watchdog',
    ],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-audio-output',

      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--lang=ja-JP',
    ]
  });

  return browser;
}

async function createBrowserPage(browser) {
  const page = await browser.newPage();

  // 设置页面语言和地区
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP' });

  return page;
}

async function waitForNextOperation() {
  await sleep(300 + Math.random() * 500);
}

async function simulatePageClick(page, selector, scrollByY) {
  // 等待并点击注册按钮
  await page.waitForSelector(selector, { visible: true, timeout: 10_000 });

  if (scrollByY) {
    await page.evaluate((scrollValue) => {
      window.scrollBy(0, scrollValue);
    }, scrollByY);
  }

  // 添加随机等待时间，模拟人为操作
  const randomDelay = Math.floor(Math.random() * 2_000) + 1_000; // 随机等待1-3秒
  await sleep(randomDelay);

  // 先hover再点击（模拟鼠标移动）
  // await page.hover('selector');
  // await waitForNextOperation();

  await page.click(selector);
}

async function simulatePageInput(page, selector, content, scrollByY) {
  // 等待页面加载完成
  await page.waitForSelector(selector, { visible: true, timeout: 10_000 });

  if (scrollByY) {
    await page.evaluate((scrollValue) => {
      window.scrollBy(0, scrollValue);
    }, scrollByY);
  }

  // 聚焦到指定的输入框
  await page.click(selector);
  await waitForNextOperation();

  // 输入账号，模拟人为输入速度
  await page.type(selector, content, {
    delay: Math.floor(Math.random() * 100) + 50  // 随机延迟50-150毫秒
  });
}

async function humanType(page, selector, text, options = {}) {
  const { minDelay = 50, maxDelay = 150, errorRate = 0.05 } = options;

  await page.focus(selector);

  for (let char of text) {
    // 偶尔打错（模拟真实用户）
    if (Math.random() < errorRate) {
      const wrongChar = String.fromCharCode(char.charCodeAt(0) + 1);
      await page.keyboard.type(wrongChar, { delay: minDelay + Math.random() * (maxDelay - minDelay) });
      await page.keyboard.press('Backspace');
      await sleep(100 + Math.random() * 200);
    }

    // 输入正确字符
    await page.keyboard.type(char, {
      delay: minDelay + Math.random() * (maxDelay - minDelay)
    });

    // 偶尔短暂停顿（模拟思考）
    if (Math.random() < 0.1) {
      await sleep(500 + Math.random() * 1_000);
    }
  }
}

async function simulatePageSelect(page, selector, value, scrollByY) {
  // 等待页面加载完成
  await page.waitForSelector(selector, { visible: true, timeout: 10_000 });

  if (scrollByY) {
    await page.evaluate((scrollValue) => {
      window.scrollBy(0, scrollValue);
    }, scrollByY);
  }

  // 聚焦到指定的输入框
  // await page.click(selector);
  await waitForNextOperation();

  await page.select(selector, value);
}

module.exports = {
  __esModule: true,
  createBrowserInstance,
  createBrowserPage,
  waitForNextOperation,
  simulatePageClick,
  simulatePageInput,
  humanType,
  simulatePageSelect
};
