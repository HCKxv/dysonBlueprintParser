// 公元 1 年到 1970 年 1 月 1 日的 ticks 数
const EPOCH_OFFSET_TICKS = 621355968000000000;

function ticksTime(ticks) {
  // 1 tick = 100 纳秒，1 毫秒 = 10000 ticks
  const ms = (ticks - EPOCH_OFFSET_TICKS) / 10000;

  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);  // 月份从 0 开始
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getCurrentTicks() {
  const localMs = Date.now() - new Date().getTimezoneOffset() * 60000;
  return localMs * 10000 + EPOCH_OFFSET_TICKS;
}

// 比较版本号：v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
function compareVersion(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const maxLen = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0; // 不足的位补 0
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export {
  ticksTime,
  getCurrentTicks,
  compareVersion,
};
