const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { default: createLogger } = require('../utils/logger');
const config = require('../config/default');
const dayjs = require('dayjs');

const logger = createLogger('EMAIL');

let client = null;
let lastProcessedUID = 0;

// 生命周期控制
let waitController = null;
let stopped = false;
let generation = 0;

async function start() {
  const myGen = ++generation;
  stopped = false;

  // 优雅关闭旧 client
  if (client) {
    await shutdownClient(client);
    client = null;
  }

  const imap = new ImapFlow({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.tls,
    auth: {
      user: config.email.user,
      pass: config.email.password
    },
    logger: false,
    emitLogs: false,
    // 关键：针对163邮箱，设置合理的超时，防止死锁
    verifyOnly: false
  });

  client = imap;

  // 添加错误监听器，防止未处理的错误导致进程崩溃
  imap.on('error', (err) => {
    logger.error(`IMAP 连接错误: ${err.message}`, err);
    // 不要在这里直接重启，让 close 事件处理重启逻辑
  });

  imap.on('close', () => {
    if (generation !== myGen || stopped) return;
    logger.warn('IMAP close，准备重启');
    setTimeout(() => {
      if (!stopped && generation === myGen) {
        start();
      }
    }, 5000);
  });

  try {
    logger.info('连接 IMAP...');
    await imap.connect();
    await mainLoop(imap, myGen);
  } catch (err) {
    logger.error(`启动失败: ${err.message}`);
    if (!stopped && generation === myGen) {
      setTimeout(start, 5000);
    }
  }
}

async function mainLoop(imap, myGen) {
  const lock = await imap.getMailboxLock('INBOX');

  try {
    await fetchAndProcessEmails(imap);

    while (
      !stopped &&
      generation === myGen &&
      imap.usable
    ) {
      logger.info('等待新邮件...');

      waitController = new AbortController();
      const { signal } = waitController;

      const onExists = (data) => {
        const newCount = data.count - data.prevCount;
        logger.info(`监测到新邮件事件 (新增 ${newCount} 封 / 总计 ${data.count})`);

        abortWait();
      };

      imap.on('exists', onExists);

      const heartbeat = setInterval(() => {
        if (imap.usable) imap.noop().catch(() => {});
      }, 20_000);

      try {
        await abortableWait(signal);
      } catch {
        // 正常中断
      } finally {
        clearInterval(heartbeat);
        imap.off('exists', onExists);
      }

      if (!imap.usable || stopped || generation !== myGen) break;

      await fetchAndProcessEmails(imap);
    }
  } finally {
    lock.release();
  }
}

function abortableWait(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      return reject(new Error('Aborted'));
    }

    const onAbort = () => {
      cleanup();
      reject(new Error('Aborted'));
    };

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    signal.addEventListener('abort', onAbort);
  });
}

function abortWait() {
  if (waitController && !waitController.signal.aborted) {
    waitController.abort();
  }
}

async function shutdownClient(imap) {
  try {
    abortWait();
    if (imap.usable) {
      await imap.logout();
    }
  } catch {}
  try {
    imap.close();
  } catch {}
}

async function fetchAndProcessEmails(imap) {
  let criteria;
  if (lastProcessedUID > 0) {
    criteria = { uid: `${lastProcessedUID + 1}:*` };
  } else {
    // 首次只搜最近 60 分钟
    const sinceDate = dayjs().subtract(60, 'minute').toDate();
    criteria = { since: sinceDate };
    logger.info(`首次扫描，查找 ${sinceDate.toLocaleString()} 之后的邮件`);
  }

  const messages = imap.fetch(criteria, {
    uid: true,
    envelope: true,
    source: true
  });

  for await (const msg of messages) {
    const msgUid = msg.uid;
    if (msgUid <= lastProcessedUID) {
      continue;
    } else {
      lastProcessedUID = msgUid;
    }

    const fromAddress = msg.envelope.from[0].address;
    const toAddress = msg.envelope.to[0].address;
    logger.info(`命中目标邮件 UID:${msgUid} 主题: ${msg.envelope.subject} 来自: ${fromAddress} 收件人: ${toAddress}`);
    try {
      const parsed = await simpleParser(msg.source);
      const res = analyzeEmailContent(msg.envelope.date, parsed.text || parsed.html);
      if (res) {
        logger.info(`解析成功 UID:${msg.uid} 主题:${parsed.subject} 结果: ${JSON.stringify(res)}`);
        process.send({
          type: 'EMAIL_FOUND',
          data: {
            uid: msgUid,
            sender: fromAddress,
            subject: parsed.subject,
            recipient: toAddress,
            receiveDate: msg.envelope.date,
            ...res,
          }
        });
      }
    } catch (e) {
      logger.error(`解析失败 UID:${msgUid} 错误: ${e.message}`);
    }
  }
}

function analyzeEmailContent(receiveDate, content) {
  if (!content) return null;
  // 匹配包含 /new-customer/ 或 /new-customer? 的 URL
  const url = content.match(/(https:\/\/www\.pokemoncenter-online\.com\/new-customer[\/\?][^\s"'<>]*)/)?.[1];
  if (url) {
    // 检查 URL 是否在60分钟内有效
    const now = new Date();
    const receivedTime = new Date(receiveDate);
    const timeDiffInMinutes = (now - receivedTime) / (1000 * 60);

    if (timeDiffInMinutes <= config.register.timeOfRegisterUrlInMail) {
      return { type: 'register_url', result: url };
    } else {
      // console.log(`URL 已超过60分钟有效期，接收时间: ${receivedTime}, 当前时间: ${now}`);
      return null;
    }
  }

  const code = content.match(/验证码[：:]\s*(\d{6})/)?.[1];

  return code ? { type: 'login_captcha', result: code } : null;
}

// IPC
process.on('message', (msg) => {
  if (msg.type === 'INIT_UID') {
    lastProcessedUID = msg.uid || 0;
    start();
  }

  if (msg.type === 'STOP') {
    logger.warn('收到 STOP');
    stopped = true;
    abortWait();
    if (client) shutdownClient(client);
  }
});

process.on('SIGINT', async () => {
  stopped = true;
  abortWait();
  if (client) await shutdownClient(client);
  process.exit(0);
});
