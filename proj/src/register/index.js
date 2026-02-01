const { default: createLogger } = require('../utils/logger');
const config = require('../config/default');
const dayjs = require('dayjs');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { sleep, waitForNextOperation, simulatePageClick, simulatePageInput, simulatePageSelect } = require('../utils');

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
    const accountCell = sheet[`H${rowIndex}`];
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

async function getValidRegisterUrl(account) {
  // 从主进程获取数据库中是否已收到最新的注册链接
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
    }, 5000); // 5秒超时

    process.send({
      type: 'GET_NEWEST_REGISTER_URL',
      data: {
        account: account
      }
    });
  });

  try {
    return await checkNewestUrlPromise;
  } catch {
    return null;
  }
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

    // 是日本ip，继续操作
    const registerUrl = await getValidRegisterUrl(accountData.account);
    // 注册链接是否有效
    if (registerUrl) {
      logger.info(`从数据库获取到最新的注册链接: ${registerUrl}`);

      await waitForRegisterEmail(browser, null, registerUrl, accountData);
    } else {
      // 新建页面并打开 Pokemon Center 网站
      const pokemonPage = await browser.newPage();
      await pokemonPage.goto('https://www.pokemoncenter-online.com/login/', { waitUntil: 'networkidle2', timeout: 60000 });

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
      await pokemonPage.waitForNavigation({ timeout: 60000 }); // 等待页面跳转

      // 检查是否到达预期的确认页面
      const currentUrl = pokemonPage.url();
      if (!currentUrl.includes('temporary-customer-confirm')) {
        throw new Error(`未跳转到预期的确认页面，当前URL: ${currentUrl}`);
      }

      logger.info('已跳转到临时客户确认页面');

      // 等待页面元素加载
      await pokemonPage.waitForSelector('input[type="email"][name="email"]', { visible: true, timeout: 10000 });

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
      await simulatePageClick(pokemonPage, '#send-confirmation-email', Math.random() * 100);

      // 等待 REGISTER_EVENT 事件触发
      logger.info('已点击发送确认邮件按钮，等待 REGISTER_EVENT 事件...');

      await waitForRegisterEmail(browser, pokemonPage, null, accountData);
    }
  } catch (error) {
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function waitForRegisterEmail(browser, pokemonPage, registerUrl, accountData) {
  try {
    if (!registerUrl) {
      // 如果数据库中没有找到注册链接，则创建 Promise 监听邮箱事件
      const registerEventPromise = new Promise((resolve, reject) => {
        let timeoutId;
        const handleMessage = (msg) => {
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

        timeoutId = setTimeout(() => {
          // 在超时情况下也要移除事件监听器
          process.removeListener('message', handleMessage);
          reject(new Error('等待 REGISTER_EVENT 事件超时'));
        }, config.register.timeOfListemRegisterUrl * 60 * 1000); // 60分钟超时

        process.on('message', handleMessage);
      });

      registerUrl = await registerEventPromise;
    }

    if (!registerUrl) {
      throw new Error('注册链接接收超时');
    }

    logger.info(`收到注册链接: ${registerUrl}`);

    // 随机处理界面关闭
    const closeRandomly = Math.random() > 0.5;
    if (closeRandomly && pokemonPage) {
      await pokemonPage.close();
    }

    // 随机等待一段时间，模拟人为操作
    const waitTime = Math.floor(Math.random() * 5000) + 1000;
    await sleep(waitTime);

    // 继续后续注册流程
    await continueRegister(browser, registerUrl, accountData);
  } catch (error) {
    throw error;
  }
}

async function continueRegister(browser, registerUrl, accountData) {
  // 打开新的页面并访问注册链接
  const registerPage = await browser.newPage();
  await registerPage.goto(registerUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  logger.info(`已打开注册链接: ${registerUrl}`);

  // 检查是否被重定向到错误页面
  const currentUrl = registerPage.url();
  if (/https:\/\/www\.pokemoncenter-online\.com\/error.*message=error\.message\.account\.invalid.*/.test(currentUrl)) {
    throw new Error('注册链接已过期');
  }

  // 等待页面元素加载
  await registerPage.waitForSelector('body', { visible: true, timeout: 10000 });

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

  // TODO: 填写地址信息

  // 市区町村 请输入全角12字符以内。（输入邮编后会自动填充）
  // const city = ''; //
  // await simulatePageInput(registerPage, '#registration-form-address-level2', city, (Math.random() * 100) + 20);
  // logger.info(`已输入市区町村: ${city}`);

  // 番地（门牌号）请输入全角16字符以内。如果地址中没有门牌号，请输入“无门牌号”。
  const houseNumber = '番地なし';
  await simulatePageInput(registerPage, '#registration-form-address-line1', houseNumber, (Math.random() * 100) + 20);
  logger.info(`已输入番地: ${houseNumber}`);

  /*
  await waitForNextOperation();

  // 建物名・部屋番号（可选） 请输入16个全角字符以内。
  const building = ''; // コーポウエダ201（d2293)
  await simulatePageInput(registerPage, '#registration-form-address-line2', building, (Math.random() * 100) + 20);
  logger.info(`已输入建物名・部屋番号: ${building}`);
  */

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
  await registerPage.waitForSelector('#terms', { visible: true, timeout: 10000 });
  await waitForNextOperation();
  if (!(await registerPage.$eval('#terms', el => el.checked))) {
    await registerPage.click('#terms');
    logger.info('已勾选条款协议');
  }

  await registerPage.waitForSelector('#privacyPolicy', { visible: true, timeout: 10000 });
  await waitForNextOperation();
  if (!(await registerPage.$eval('#privacyPolicy', el => el.checked))) {
    await registerPage.click('#privacyPolicy');
    logger.info('已勾选隐私政策');
  }

  await waitForNextOperation();

  await registerPage.evaluate((scrollValue) => {
    window.scrollBy(0, scrollValue);
  }, (Math.random() * 50) + 20);

  // 随机等待一段时间
  await sleep(Math.floor(Math.random() * 1000) + 500);

  // 注册按钮
  await simulatePageClick(registerPage, '#registration_button', Math.random() * 100);

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
    await sleep(1000); // 等待1秒
  }

  logger.info('超过最大等待时间，页面仍未跳转到预期URL');
  await registerPage.close();

  const timeoutError = new Error('完成注册信息填写，后页面跳转检测超时');
  timeoutError.name = 'TimeoutError';
  throw timeoutError;
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

        process.send({
          type: 'REGISTER_ACCOUNT_SUCCESS',
          data: {
            account: accountData.account
          }
        });
      } catch (error) {
        logger.error(`处理账号 ${accountData.account} 时出错: ${error.message}`);

        // 根据错误类型确定状态值
        const isErrorExpired = error.message.includes('注册链接已过期');
        const isTimeout = error.name === 'TimeoutError';
        const status = (isErrorExpired || isTimeout) ? 0 : 2; // 注册链接过期则状态设为0，其他错误设为2

        // 发送错误信息给主进程，以便写入数据库 Account 的 reason 字段
        process.send({
          type: 'REGISTER_ACCOUNT_ERROR',
          data: {
            account: accountData.account,
            reason: error.message,
            status: status
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
