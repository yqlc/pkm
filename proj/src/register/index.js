const createLogger = require('../utils/logger');
const dayjs = require('dayjs');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

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
      account: sheet[`D${rowIndex}`]?.v,
      password: sheet[`E${rowIndex}`]?.v ?? null,
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

// IPC
process.on('message', (msg) => {
  if (msg.type === 'START') {
    listenXlsxPath = msg.filePath;
    if (stopped) {
      stopped = false;

      start();
    }
  }

  // 接收主进程过来的注册未完成账号
  if (msg.type === 'PENDING_ACCOUNTS') {
    const accounts = msg.accounts;
    logger.info(`收到主进程发送的 ${accounts.length} 条未完成注册的账号`);
    registerAccounts.push(...accounts);
  }

  if (msg.type === 'STOP') {
    logger.warn('收到 STOP');
    stopped = true;
  }
});

process.on('SIGINT', async () => {
  stopped = true;
  process.exit(0);
});
