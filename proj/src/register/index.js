const { default: createLogger } = require('../utils/logger');
const config = require('../config/default');
const dayjs = require('dayjs');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const { createBrowserInstance } = require('../puppeteer/utils');
const { default: getCurrentIpInfo } = require('../puppeteer/ipinfo');
const { triggerSendRegisterEmail, continueRegister } = require('../puppeteer/register');
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

        if (accounts.length > 0) {
          process.send({ type: 'FIND_ACCOUNTS', accounts: accounts });
        }

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

    // 等待 60 秒后再次检查
    await sleep(60_000);
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

    const acc = {
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
    };

    // 如果K列值为1，说明是已注册成功的账号，只需导入即可
    if (1 == sheet[`K${rowIndex}`]?.v) {
      acc.status = 1;
    }

    rows.push(acc);

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
  try {
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
      }, 10_000); // 10秒超时

      process.send({
        type: 'GET_NEWEST_REGISTER_URL',
        data: {
          account: account
        }
      });
    });

    return await checkNewestUrlPromise;
  } catch {
    return null;
  }
}

async function waitForRegisterEmail(browser, accountData) {
  // 监听邮箱中的注册邮件
  try {
    const registerEventPromise = new Promise((resolve, reject) => {
      let timeoutId;
      const handleMessage = (msg) => {
        if (msg.type === 'REGISTER_EVENT'
            && msg.data?.account === accountData.account) {

          // 清除超时定时器
          clearTimeout(timeoutId);
          process.removeListener('message', handleMessage);

          if (msg.data?.registered) {
            resolve(true);
          } else if (msg.data?.url) {
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

    return await registerEventPromise;
  } catch (error) {
    throw error;
  }
}

async function actualRegisterLogic(accountData) {
  logger.info(`开始处理账号: ${accountData.account}`);

  let browser;
  try {
    browser = await createBrowserInstance(accountData);

    // 使用 Puppeteer 获取当前 IP 所在地域
    const ipInfo = await getCurrentIpInfo(browser);

    if (ipInfo.country !== 'JP') {
      throw new Error(`IP地址 ${ipInfo.ip} 不在日本，当前地区: ${ipInfo.region}, ${ipInfo.country}, ${ipInfo.city}`);
    }

    logger.debug(`当前IP地址: ${ipInfo.ip}, 所在地区: ${ipInfo.region}, ${ipInfo.country}, ${ipInfo.city}`);

    // 是日本ip，继续操作
    const registerUrl = await getValidRegisterUrl(accountData.account);
    // 注册链接是否有效
    if (registerUrl) {
      logger.info(`从数据库获取到最新的注册链接: ${registerUrl}`);

      // 继续后续注册流程
      await continueRegister(browser, logger, registerUrl, accountData);
    } else {
      // 触发发送注册邮件
      const pokemonPage = await triggerSendRegisterEmail(browser, logger, accountData);

      // 等待注册邮件到达
      const newRegisterUrl = await waitForRegisterEmail(browser, accountData);
      if (newRegisterUrl === true) {
        await pokemonPage.close();
        logger.info('该邮箱已注册过了');
        return;
      }

      if (!newRegisterUrl) {
        throw new Error('注册链接接收超时');
      }

      logger.info(`收到注册链接: ${newRegisterUrl}`);

      // 随机处理界面关闭
      const closeRandomly = Math.random() > 0.5;
      if (closeRandomly && pokemonPage) {
        await pokemonPage.close();
      }

      // 继续后续注册流程
      await continueRegister(browser, logger, newRegisterUrl, accountData);
    }
  } catch (error) {
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
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
      // 如果没有待处理的账号，暂停30秒再检查
      await sleep(30_000);
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
