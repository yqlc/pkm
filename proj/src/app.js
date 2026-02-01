const { EventEmitter } = require('events');
const { mainLogger } = require('./utils/logger');
const { sequelize, EmailLog } = require('./database');
const { default: startEmailWorker } = require('./main/email');
const { default: startRegisterWorker } = require('./main/register');

const eventBus = new EventEmitter();

// 处理未捕获异常，防止进程意外崩溃
process.on('uncaughtException', (err) => mainLogger.error(`未捕获异常: ${err.message}`));
process.on('unhandledRejection', (reason) => mainLogger.error(`未处理 Promise: ${reason}`));

async function initSystem() {
  try {
    // 先配置key
    // await sequelize.query(`PRAGMA key = '${config.db.encryptionKey}';`);
    await sequelize.authenticate();
    // 同步数据库结构
    await sequelize.sync(); // 生产环境建议用 Migrations，这里简化为 sync

    mainLogger.info('数据库已连接并同步');

    // 2. 启动邮箱子进程，获取最后一次处理的邮件UID，用于断点续传
    const lastLog = await EmailLog.findOne({ order: [['uid', 'DESC']] });
    const lastUid = lastLog ? lastLog.uid : 0;
    startEmailWorker(eventBus, mainLogger, lastUid);

    // 3. 启动注册子进程
    startRegisterWorker(eventBus, mainLogger);

    // 4. 初始化其他模块 (暂时留空)

    mainLogger.info('系统初始化完成，等待任务...');

  } catch (err) {
    mainLogger.error(`系统启动失败: ${err.message}`);
    process.exit(1);
  }
}

// 启动
initSystem();

module.exports = { eventBus }; // 导出供其他模块使用
