const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const dayjs = require('dayjs');

let client = null;
let lastProcessedUID = 0;
let isRunning = false;
let retryTimer = null;

async function start() {
  if (retryTimer) clearTimeout(retryTimer);
  
  // 先把旧的引用存到临时变量，防止干扰
  const oldClient = client;
  client = null; // 全局立即置空，阻止新的操作使用旧实例
  
  if (oldClient) {
    try {
      // 尝试优雅关闭旧连接（如果还没关）
      oldClient.close(); 
    } catch (e) { /* ignore */ }
  }

  // 实例化新对象
  client = new ImapFlow({
    host: 'imap.163.com',
    port: 993,
    secure: true,
    auth: {
      user: 'relax-happy@163.com',
      pass: 'GQYPVgUdZvvXzhVy'
    },
    logger: false,
    emitLogs: false,
    // 关键：针对163邮箱，设置合理的超时，防止死锁
    verifyOnly: false
  });

  // 绑定事件
  client.on('error', (err) => {
    // 忽略部分网络错误，由 close 处理
    if (!err.message.includes('Connection closed')) {
        console.error(`IMAP 错误: ${err.message}`);
    }
  });

  client.on('close', () => {
    console.warn('IMAP 连接已关闭，准备重建实例...');
    isRunning = false;
    retryTimer = setTimeout(start, 5000); // 5秒后重启
  });

  // 开始连接
  try {
    console.info('正在连接邮箱...');
    await client.connect();
    console.info('IMAP 已连接');
    isRunning = true;
    await mainLoop();
  } catch (err) {
    console.error(`启动失败: ${err.message}`);
    // 如果 connect 失败，手动触发重启
    if (client) client.close(); 
  }
}

async function mainLoop() {
  while (client && client.usable) {
    // --- 阶段 A: 拉取邮件 ---
    let lock;
    try {
      // 获取锁之前也检查一下
      if (!client) break;
      lock = await client.getMailboxLock('INBOX');
      await fetchAndProcessEmails(client);
    } catch (err) {
      console.error(`拉取邮件时出错: ${err.message}`);
    } finally {
      if (lock) lock.release();
    }

    // --- 阶段 B: 等待新邮件 (IDLE) ---
    if (!client || !client.usable) break;

    console.info('进入 IDLE 模式，等待新邮件...');
    
    const onExists = (data) => {
      // 【计算新增数量
      const newCount = data.count - data.prevCount;
      console.info(`监测到新邮件事件 (新增 ${newCount} 封 / 总计 ${data.count})，打断 IDLE...`);
      
      // 安全检查：只有当 client 存在且连接正常时才调用 stop
      if (client && client.usable) {
        client.stop(); 
      }
    };

    client.once('exists', onExists);

    try {
      await client.idle({ timeout: 10 * 60 * 1000 }); 
    } catch (err) {
      // IDLE 被 stop() 打断或者超时，或者连接断开都会到这里
      // 连接断开导致的错误不需要特别处理，外层循环会判断 client.usable
      if (err.message !== 'Idle interrupted') {
        console.info(`IDLE 结束状态: ${err.message}`);
      }
    } finally {
      // 【修复2】防止 client 为 null 时的崩溃
      // 必须先检查 client 是否存在，再移除监听
      if (client) {
        client.off('exists', onExists);
      }
    }
  }
}

async function fetchAndProcessEmails(currentClient) {
  let searchCriteria = {};

  if (lastProcessedUID > 0) {
    searchCriteria = { uid: `${lastProcessedUID + 1}:*` };
  } else {
    // 首次只搜最近 30 分钟
    const sinceDate = dayjs().subtract(30, 'minute').toDate();
    searchCriteria = { since: sinceDate };
    console.info(`首次扫描，查找 ${sinceDate.toLocaleString()} 之后的邮件`);
  }

  // 获取邮件列表
  // 注意：fetch 方法不会抛错如果没邮件，它只是返回空迭代器
  const messages = currentClient.fetch(searchCriteria, {
    uid: true,
    envelope: true,
    source: true
  });

  for await (let msg of messages) {
    const uid = msg.uid;
    if (uid > lastProcessedUID) lastProcessedUID = uid;

    const fromAddress = msg.envelope.from[0].address;
    
    // 简单日志
    console.debug(`扫描到邮件: ${msg.envelope.subject}`);

    // if (!fromAddress.includes(config.email.targetSender)) {
    //   continue;
    // }

    console.info(`命中目标邮件 UID:${uid} 来自: ${fromAddress}`);

    try {
      const parsed = await simpleParser(msg.source);
      const analysisResult = analyzeEmailContent(parsed.text || parsed.html);

      if (analysisResult) {
        // process.send({
        //   type: 'EMAIL_FOUND',
        //   data: {
        //     uid: uid,
        //     sender: fromAddress,
        //     subject: msg.envelope.subject,
        //     ...analysisResult
        //   }
        // });
        console.info(`提取结果: ${JSON.stringify(analysisResult)}`);
      }
    } catch (parseErr) {
      console.error(`解析失败: ${parseErr.message}`);
    }
  }
}

function analyzeEmailContent(content) {
  if (!content) return null;
  const codeMatch = content.match(/验证码[：:]\s*(\d{6})/);
  const urlMatch = content.match(/(https?:\/\/[^\s"']+)/);

  if (codeMatch || urlMatch) {
    return {
      code: codeMatch ? codeMatch[1] : null,
      url: urlMatch ? urlMatch[1] : null
    };
  }
  return null;
}

process.on('message', (msg) => {
  if (msg.type === 'INIT_UID') {
    lastProcessedUID = msg.uid || 0;
    console.info(`同步 UID: ${lastProcessedUID}`);
    start();
  }
});

// 优雅退出
process.on('SIGINT', async () => {
  if (client) await client.logout();
  process.exit();
});


lastProcessedUID = 0;
start();