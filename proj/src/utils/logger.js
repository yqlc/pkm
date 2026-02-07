const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const util = require('util');

// 处理元数据对象的实用函数
const formatMeta = (meta) => {
  if (!meta) return '';

  const cleanMeta = { ...meta };
  // 过滤掉可能存在的Symbol属性
  Object.getOwnPropertySymbols(cleanMeta).forEach(sym => {
    delete cleanMeta[sym];
  });

  if (Object.keys(cleanMeta).length === 0) return '';

  if (cleanMeta instanceof Error) {
    return `${cleanMeta.stack || cleanMeta.message}`;
  }

  return util.inspect(cleanMeta, {
    depth: 4,
    colors: false,
    compact: true,
    breakLength: Infinity
  });
};

const printfFormat = winston.format.printf(({ timestamp, level, message, label, ...meta }) => {
  // 处理消息本身
  const formattedMessage = typeof message === 'object'
    ? JSON.stringify(message)
    : message;

  // 格式化元数据
  const formattedMeta = formatMeta(meta);

  return `[${timestamp}] [${label || 'MAIN'}] ${level.toUpperCase()}: ${formattedMessage} ${formattedMeta}`.trim();
});

const createLogger = (label) => {
  return winston.createLogger({
    format: winston.format.combine(
      winston.format.label({ label }),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      printfFormat
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.label({ label }),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          printfFormat,
          winston.format.colorize({ all: true })
        )
      }),
      new DailyRotateFile({
        filename: path.join(__dirname, '../logs', 'application-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d'
      })
    ]
  });
};

const mainLogger = createLogger('MAIN');

module.exports = {
  __esModule: true,
  default: createLogger,
  mainLogger
};
