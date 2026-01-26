const { Sequelize, DataTypes } = require('sequelize');
const config = require('../config/default');
const path = require('path');
const fs = require('fs-extra');

// 确保数据库目录存在
fs.ensureDirSync(path.dirname(config.db.storage));

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: config.db.storage,
  logging: false // 关闭SQL控制台输出，保持日志纯净
});

// 定义邮件记录表，用于防止重复处理
const EmailLog = sequelize.define('EmailLog', {
  uid: { type: DataTypes.INTEGER, allowNull: false, unique: true }, // 邮件唯一ID
  sender: DataTypes.STRING,
  subject: DataTypes.STRING,
  parsed_code: DataTypes.STRING, // 提取出的验证码
  parsed_url: DataTypes.STRING,  // 提取出的跳转链接
  processed: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// 这里可以继续定义 Account 表...

module.exports = { sequelize, EmailLog };