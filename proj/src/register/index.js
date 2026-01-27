const createLogger = require('../utils/logger');
const config = require('../config/default');
const dayjs = require('dayjs');
const xlsx = require('xlsx');
const path = require('path');

const logger = createLogger('REGISTER');

let stopped = false;

async function start() {
  logger.info('注册模块启动');
  // 这里可以添加注册相关的逻辑
async function importExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];

  if (!sheet) throw new Error('Sheet1 不存在');

  await sequelize.sync(); // 自动建表

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
  while (!stopped) {  
    await new Promise(resolve => setTimeout(resolve, 10000)); // 模拟工作
  }
}

// IPC
process.on('message', (msg) => {
  if (msg.type === 'START') {
    stopped = false;
    start();
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
