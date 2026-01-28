require('dotenv').config();

module.exports = {
  // 数据库配置
  db: {
    storage: './asset/pkm.sqlite',
    encryptionKey: process.env.DB_ENCRYPTION_KEY // 如使用加密数据库，请设置此项
  },
  // 邮箱监控配置
  email: {
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '', // 注意：是IMAP授权码，不是登录密码
    host: process.env.EMAIL_HOST || 'imap.163.com',
    port: parseInt(process.env.EMAIL_PORT) || 993,
    tls: true,
  }
};