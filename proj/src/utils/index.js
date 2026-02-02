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


module.exports = {
  __esModule: true,
  sleep,
};
