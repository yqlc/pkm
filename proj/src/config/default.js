module.exports = {
  // 数据库配置
  db: {
    storage: './asset/pkm.sqlite',
    encryptionKey: 'pKmNdjs688' // 如使用加密数据库，请设置此项
  },
  // 邮箱监控配置
  email: {
    user: 'relax-happy@163.com',
    password: 'GQYPVgUdZvvXzhVy', // 注意：是IMAP授权码，不是登录密码
    host: 'imap.163.com',
    port: 993,
    tls: true,
    targetSender: 'info@xx.com', // 只分析来自该发件人的邮件
  }
};