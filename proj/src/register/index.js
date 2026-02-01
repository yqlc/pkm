const { default: createLogger } = require('../utils/logger');
const config = require('../config/default');
const dayjs = require('dayjs');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { sleep } = require('../utils');

const logger = createLogger('REGISTER');

let listenXlsxPath = null;
let stopped = true;
const registerAccounts = [];

async function start() {
  logger.info('注册模块启动');

  while (stopped === false && listenXlsxPath) {
    try {
      if (fs.existsSync(listenXlsxPath)) {

        const accounts = parseAccountsFromXlsx(listenXlsxPath);
        logger.info(`读取到 ${accounts.length} 条注册数据`);

        process.send({ type: 'FIND_ACCOUNTS', accounts: accounts });

        try {
          const ext = path.extname(listenXlsxPath) || '';
          const dir = path.dirname(listenXlsxPath);
          const base = path.basename(listenXlsxPath, ext);
          const timestamp = dayjs().format('YYYYMMDD_HHmmss');
          const newName = `${base}_${timestamp}${ext}`;
          const newPath = path.join(dir, newName);

          await fs.promises.rename(listenXlsxPath, newPath);
          logger.info(`已将注册文件重命名为 ${newPath}`);

        } catch (err) {
          logger.error(`重命名注册文件失败: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`读取注册文件失败: ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}

function parseAccountsFromXlsx(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];

  if (!sheet) throw new Error('Sheet1 不存在');

  const rows = [];
  let rowIndex = 4;

  while (true) {
    const accountCell = sheet[`D${rowIndex}`];
    if (!accountCell || !accountCell.v) break;

    const birthdayRaw = sheet[`J${rowIndex}`]?.v;

    let birthday = null;
    if (birthdayRaw) {
      birthday =
        typeof birthdayRaw === 'number'
          ? xlsx.utils.format_cell({ v: birthdayRaw, t: 'n', z: 'yyyy-mm-dd' })
          : birthdayRaw.replace(/\//g, '-');
    }

    rows.push({
      fingerprintId: sheet[`B${rowIndex}`]?.v ?? null,
      account: sheet[`H${rowIndex}`]?.v,
      password: sheet[`I${rowIndex}`]?.v ?? null,
      phone: sheet[`F${rowIndex}`]?.v ?? null,
      birthday,
      jpName: sheet[`L${rowIndex}`]?.v ?? null,
      fullwidthName: sheet[`M${rowIndex}`]?.v ?? null,
      romanName: sheet[`N${rowIndex}`]?.v ?? null,
      zipCode: sheet[`V${rowIndex}`]?.v ?? null,
      address: sheet[`W${rowIndex}`]?.v ?? null,
    });

    rowIndex++;
  }

  return rows;
}

//#region 账号注册
let isProcessingAccounts = false;

// 检查账号是否已在队列中
function isAccountInQueue(account) {
  return registerAccounts.some(acc => acc.account === account);
}

async function actualRegisterLogic(accountData) {
  logger.info(`开始处理账号: ${accountData.account}`);

  // 使用 Puppeteer 获取当前 IP 所在地域
  let browser;
  try {
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

    // 从配置获取浏览器执行路径
    browser = await puppeteer.launch({
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

    const page = await browser.newPage();

    // 设置页面语言和地区
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP' });

    // 访问一个可以显示IP地理位置的服务
    await page.goto('https://ipinfo.io/json', { waitUntil: 'networkidle2' });

    // 获取页面内容
    const ipInfo = await page.evaluate(() => {
      return JSON.parse(document.body.textContent);
    });

    // 关闭当前页面
    await page.close();

    if (ipInfo.country !== 'JP') {
      throw new Error(`IP地址 ${ipInfo.ip} 不在日本，当前地区: ${ipInfo.region}, ${ipInfo.country}, ${ipInfo.city}`);
    }

    logger.debug(`当前IP地址: ${ipInfo.ip}, 所在地区: ${ipInfo.region}, ${ipInfo.country}, ${ipInfo.city}`);

    // 新建页面并打开 Pokemon Center 网站
    const pokemonPage = await browser.newPage();
    await pokemonPage.goto('https://www.pokemoncenter-online.com/login/', { waitUntil: 'networkidle2' });

    logger.info('已打开 Pokemon Center 网站');

    // 等待页面加载完成
    await pokemonPage.waitForSelector('#login-form-regist-email', { timeout: 10000 });

    // 聚焦到指定的输入框
    await pokemonPage.focus('#login-form-regist-email');

    // 输入账号，模拟人为输入速度
    await pokemonPage.type('#login-form-regist-email', accountData.account, {
      delay: Math.floor(Math.random() * 100) + 50  // 随机延迟50-150毫秒
    });

    logger.info(`已输入账号: ${accountData.account}`);

    // 等待并点击注册按钮
    await pokemonPage.waitForSelector('#form2Button', { timeout: 10000 });

    // 添加随机等待时间，模拟人为操作
    let randomDelay = Math.floor(Math.random() * 2000) + 1000; // 随机等待1-3秒
    await sleep(randomDelay);

    await pokemonPage.click('#form2Button');

    logger.info('已点击注册按钮');

    // 等待页面跳转到确认页面
    await pokemonPage.waitForNavigation({ timeout: 15000 }); // 等待页面跳转

    // 检查是否到达预期的确认页面
    const currentUrl = pokemonPage.url();
    if (!currentUrl.includes('temporary-customer-confirm')) {
      throw new Error(`未跳转到预期的确认页面，当前URL: ${currentUrl}`);
    }

    logger.info('已跳转到临时客户确认页面');

    // 等待页面元素加载
    await pokemonPage.waitForSelector('input[type="email"][name="email"]', { timeout: 10000 });

    // 获取邮箱输入框的值并验证
    const emailValue = await pokemonPage.$eval('input[type="email"][name="email"]', el => el.value);

    if (emailValue !== accountData.account) {
      throw new Error(`邮箱值不匹配，期望: ${accountData.account}, 实际: ${emailValue}`);
    }

    logger.info(`邮箱值验证成功: ${emailValue}`);

    // 等待并点击发送确认邮件按钮
    await pokemonPage.waitForSelector('#send-confirmation-email', { timeout: 10000 });

    randomDelay = Math.floor(Math.random() * 2000) + 1000; // 随机等待1-3秒
    await sleep(randomDelay);

    await pokemonPage.click('#send-confirmation-email');

    // 等待 REGISTER_EVENT 事件触发
    logger.info('已点击发送确认邮件按钮，等待 REGISTER_EVENT 事件...');

    // 创建 Promise 来等待事件
    let handleMessage;
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        // 在超时情况下也要移除事件监听器
        process.removeListener('message', handleMessage);
        reject(new Error('等待 REGISTER_EVENT 事件超时'));
      }, 3300000); // 55分钟超时
    });

    const registerEventPromise = new Promise((resolve, reject) => {
      handleMessage = (msg) => {
        if (msg.type === 'REGISTER_EVENT') {
          // 清除超时定时器
          clearTimeout(timeoutId);
          process.removeListener('message', handleMessage);

          if (msg.data?.url) {
            resolve(msg.data.url);
          } else {
            reject(new Error('REGISTER_EVENT 事件数据无效'));
          }
        }
      };

      process.on('message', handleMessage);
    });

    try {
      const registerUrl = await Promise.race([registerEventPromise, timeoutPromise]);
      logger.info(`收到注册链接: ${registerUrl}`);

      // 随机处理界面关闭
      const closeRandomly = Math.random() > 0.5;
      if (closeRandomly) {
        await pokemonPage.close();
      }

      // 随机等待一段时间，模拟人为操作
      const waitTime = Math.floor(Math.random() * 5000) + 3000;
      await sleep(waitTime);

      // 继续后续注册流程
      await continueRegister(browser, registerUrl, accountData);
    } catch (error) {
      throw error;
    }
  } catch (error) {
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function continueRegister(browser, registerUrl, accountData) {
  // 打开新的页面并访问注册链接
  const registerPage = await browser.newPage();
  await registerPage.goto(registerUrl, { waitUntil: 'networkidle2' });

  logger.info(`已打开注册链接: ${registerUrl}`);

  // 在这里可以继续处理注册流程

  // 关闭页面
  await registerPage.close();
}

async function simulateRegister() {
  if (isProcessingAccounts) {
    return; // 如果已经在处理中，则直接返回，避免重复启动
  }

  isProcessingAccounts = true;
  logger.info('开始处理待注册账号队列...');

  while (!stopped) {
    if (registerAccounts.length > 0) {
      // 只获取第一个账号，不立即从数组中移除
      const accountData = registerAccounts[0];

      try {
        await actualRegisterLogic(accountData);

        logger.info(`账号 ${accountData.account} 注册逻辑完成`);
      } catch (error) {
        logger.error(`处理账号 ${accountData.account} 时出错: ${error.message}`);
        // 发送错误信息给主进程，以便写入数据库 Account 的 reason 字段
        process.send({
          type: 'REGISTER_ACCOUNT_ERROR',
          data: {
            account: accountData.account,
            reason: error.message
          }
        });
      } finally {
        // 操作完成后才从数组中移除
        registerAccounts.shift();
      }
    } else {
      process.send({ type: 'REGISTER_COMPLETE' });
      // 如果没有待处理的账号，暂停一段时间再检查
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  isProcessingAccounts = false;
  logger.info('账号处理队列结束');
}
//#endregion

// IPC
process.on('message', (msg) => {
  switch (msg.type) {
  case 'START':
    listenXlsxPath = msg.filePath;
    if (stopped) {
      stopped = false;

      start();
    }
    break;
  case 'PENDING_ACCOUNTS':
    // 接收主进程过来的未完成注册账号
    const accounts = msg.accounts;
    logger.info(`收到主进程发送的 ${accounts.length} 条未完成注册的账号`);

    // 只添加不在数组中的账号
    const newAccounts = accounts.filter(account => !isAccountInQueue(account.account));
    if (newAccounts.length > 0) {
      registerAccounts.push(...newAccounts);
      logger.info(`新增 ${newAccounts.length} 条待处理账号`);
    } else {
      logger.info('所有账号都已在处理队列中，无需添加');
    }

    // 启动账号处理循环（如果尚未启动）
    simulateRegister();
    break;
  // case 'REGISTER_EVENT':
  //   const emailData = msg.data;
  //   logger.info(`收到主进程发送的注册事件: ${emailData}`);
  //   break;
  case 'STOP':
    logger.warn('收到 STOP');
    stopped = true;
    process.exit(0);
  }
});

process.on('SIGINT', async () => {
  stopped = true;
  process.exit(0);
});
