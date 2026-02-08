/* eslint-disable no-console */
const nodemailer = require('nodemailer');
const config = require('../config/default');

/**
 * 使当前线程等待指定的秒数
 * @param {number} millisecond - 要等待的毫秒数
 * @returns {Promise<void>} - Promise，resolve 时等待完成
 */
function sleep(millisecond) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, Math.floor(millisecond));
  });
}

// 生成唯一标识的辅助函数
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

async function sendEmail(to, subject, text, html) {
  try {
    // 创建邮件传输器
    const transporter = nodemailer.createTransport({
      // 163邮箱SMTP配置
      host: config.email.hostSmtp,
      port: config.email.portSmtp,
      secure: config.email.smtpTls, // 163邮箱的SSL端口需要设置为true
      auth: {
        user: config.email.user, // 163邮箱地址
        pass: config.email.password // 邮箱授权码
      }
    });

    // 邮件选项
    const mailOptions = {
      from: config.email.user, // 发送方邮箱
      to: to,                          // 接收方邮箱
      subject: subject || '无主题',                    // 邮件主题
      text: text || '[空]',        // 邮件文本内容
      html: html || '<p>[空]</p>' // HTML格式的邮件内容
    };

    // 发送邮件
    const info = await transporter.sendMail(mailOptions);
    console.log('邮件发送成功:', info.messageId);
  } catch (error) {
    console.error('邮件发送失败:', error);
  }
}

module.exports = {
  __esModule: true,
  sleep,
  generateUniqueId,
  sendEmail,
};
