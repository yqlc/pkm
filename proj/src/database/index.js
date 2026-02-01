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
  recipient: DataTypes.STRING,
  subject: DataTypes.STRING,
  parsed_result: DataTypes.STRING,  // 提取出的结果
  processed: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// 定义 Account 表
// 注意：修改字段时，需要同步调整 updateOnDuplicate 中的字段
const Account = sequelize.define('Account', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  fingerprintId: {
    type: DataTypes.STRING,
    field: 'fingerprint_id',
  },
  account: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: DataTypes.STRING,
  phone: DataTypes.STRING,
  birthday: DataTypes.DATEONLY,
  jpName: {
    type: DataTypes.STRING,
    field: 'jp_name',
  },
  fullwidthName: {
    type: DataTypes.STRING,
    field: 'fullwidth_name',
  },
  romanName: {
    type: DataTypes.STRING,
    field: 'roman_name',
  },
  zipCode: {
    type: DataTypes.STRING,
    field: 'zip_code',
  },
  address: DataTypes.STRING,
  status: {
    type: DataTypes.INTEGER,
    defaultValue: 0, // 0: 新导入, 1: 已注册, 2: 注册失败, 3: 账号异常
    comment: '状态: 0-新导入, 1-已注册, 2-注册失败, 3-账号异常'
  },
  reason: DataTypes.STRING,
}, {
  timestamps: true,
});

module.exports = { sequelize, EmailLog, Account };
