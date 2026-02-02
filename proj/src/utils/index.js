/**
 * 使当前线程等待指定的秒数
 * @param {number} millisecond - 要等待的毫秒数
 * @returns {Promise<void>} - Promise，resolve 时等待完成
 */
function sleep(millisecond) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, Math.floor(millisecond));
  });
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
  sleep,
  waitForNextOperation,
  simulatePageClick,
  simulatePageInput,
  humanType,
  simulatePageSelect
};
