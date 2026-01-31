const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const printfFormat = winston.format.printf(({ timestamp, level, message, label }) => {
  return `[${timestamp}] [${label || 'MAIN'}] ${level.toUpperCase()}: ${message}`;
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
