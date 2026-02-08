const dayjs = require('dayjs');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer-core');

async function start() {
  // testSendEmail();

  testProxy();
}

async function testProxy() {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      browser: 'chrome',
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // 从配置获取浏览器执行路径
      userDataDir: 'cacheDirectory', // 从配置获取缓存目录,
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
        // '--proxy-server=socks5://174.138.61.184:1080',
        // '--proxy-server=socks5://185.194.217.97:1080',
      ]
    });

    const page = await browser.newPage();
    // await page.goto('https://ipinfo.io/json', { waitUntil: 'networkidle2' });
    await page.goto('https://www.ip138.com', { waitUntil: 'networkidle2' });
    const title = await page.title();
    // 获取页面内容
    // const ipInfo = await page.evaluate(() => {
    //   return JSON.parse(document.body.textContent);
    // });
    // console.log('IP信息:', ipInfo);
    console.log('页面标题:', title);

    await new Promise(resolve => setTimeout(resolve, 3600_000));
  } catch (error) {
    console.error('浏览器启动失败:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function testSendEmail() {
  try {
    // 创建邮件传输器
    const transporter = nodemailer.createTransport({
      // 163邮箱SMTP配置
      host: 'smtp.163.com',
      port: 465,
      secure: true, // 163邮箱的SSL端口需要设置为true
      auth: {
        user: 'relax-happy@163.com', // 163邮箱地址
        pass: 'KQvrf3C3kDD48guZ' // 邮箱授权码
      }
    });

    // 邮件选项
    const mailOptions = {
      from: 'relax-happy@163.com', // 发送方邮箱
      to: '495860965@qq.com',                          // 接收方邮箱
      subject: '来自NodeMailer的测试邮件',                    // 邮件主题
      text: '这是一封通过NodeMailer发送的测试邮件！',        // 邮件文本内容
      html: '<h1>这是一封通过NodeMailer发送的HTML格式邮件！</h1><p>这是邮件正文。</p>' // HTML格式的邮件内容
    };

    // 发送邮件
    const info = await transporter.sendMail(mailOptions);
    console.log('邮件发送成功:', info.messageId);
    console.log('预览URL:', nodemailer.getTestMessageUrl(info));
  } catch (error) {
    console.error('邮件发送失败:', error);
  }
}

// 优雅退出
process.on('SIGINT', async () => {
  process.exit();
});

process.on('SIGTERM', async () => {
  process.exit();
});

start();