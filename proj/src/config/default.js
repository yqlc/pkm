module.exports = {
  // 数据库配置
  db: {
    storage: './asset/pkm.sqlite'
  },
  // 邮箱监控配置
  email: {
    user: 'xx@163.com',
    password: 'xx', // 注意：是IMAP授权码，不是登录密码
    host: 'imap.163.com',
    port: 993,
    tls: true,
    targetSender: 'info@xx.com', // 只分析来自该发件人的邮件
  }
};