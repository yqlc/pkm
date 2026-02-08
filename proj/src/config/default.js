const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '.env')
});

const rootDir = path.resolve(__dirname, '../');

module.exports = {
  // 数据库配置
  db: {
    storage: path.join(rootDir, 'assets/pkm.sqlite'),
    encryptionKey: process.env.DB_ENCRYPTION_KEY // 如使用加密数据库，请设置此项
  },
  // 邮箱监控配置
  email: {
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '', // 注意：是IMAP授权码，不是登录密码
    host: process.env.EMAIL_HOST || 'imap.163.com',
    port: parseInt(process.env.EMAIL_PORT) || 993,
    tls: true,
  },
  register: {
    timeOfRegisterUrlInMail: 60,  // 注册链接在邮件中的有效时间（分钟）
    timeOfListemRegisterUrl: 60,  // 监听注册链接的时间（分钟）
    timeOfListemMfaCode: 5,       // 监听MFA登录验证码的时间（分钟）
    excelFilePath: path.join(rootDir, process.env.REGISTER_EXCEL_FILE_PATH || 'assets/accounts.xlsx')
  },
  browser: {
    fingerprintDir: path.join(rootDir, 'assets/fingerprints'), // 浏览器指纹数据目录
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // 指定浏览器可执行文件路径
    userDataBaseDir: path.join(rootDir, 'assets/browserData'), // 浏览器用户数据目录
  },
  service: {
    port: process.env.SERVICE_HOST_PORT || 8080,
  },
  tasks: {
    mobile: {
      concurrenceCount: 4,
    }
  }
};
