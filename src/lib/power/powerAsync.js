/**
 * powerAsync — 结构与细胞点数计算的异步入口（把 power.js 的 computePoints 放到 Worker 线程里跑）
 * 
 *   - 每个请求独占一只 Worker，算完即终止（不常驻，省内存）
 *   - 同一个 key 只保留最新一次请求: 新请求会终止上一次仍在算的 Worker，
 *     旧的那次以 AbortError 结束 —— 连续改半径时不会排队算一堆过期结果
 *   - 不同 key 各算各的，互不干扰（例如主面板与「生成多层壳」弹窗）
 */

// 单次计算时限（毫秒）
const TIMEOUT_MS = 10000;

/** 在飞请求: key → { cancel } */
const inflight = new Map();

/** 「被新请求顶掉」用的错误，调用方据此静默忽略 */
function canceledError() {
  const err = new Error('发电量计算已取消');
  err.name = 'AbortError';
  return err;
}

/** postMessage 的结构化克隆失败（Vue 响应式代理等） */
function isCloneError(err) {
  if (!err) return false;
  return err.name === 'DataCloneError' || /could not be cloned/i.test(err.message || '');
}

/**
 * 取消某一路还在算的请求（例如弹窗关掉了）
 * @param {string} key - 与 computePointsAsync 的 opts.key 对应
 */
export function cancelPowerComputes(key) {
  inflight.get(key)?.cancel();
}

/**
 * 在 Worker 里算 computePoints
 *
 * @param {object} body - 解析后的蓝图数据 body（必须是原始数据，见文件头「约定」）
 * @param {number|null} r0 - 单层壳的用户半径（多层壳不使用）
 * @param {{key?: string, timeoutMs?: number}} [opts] - key: 同一路计算只保留最新一次
 * @returns {Promise<object|null>} computePoints 的返回值（无壳数据时为 null）
 */
export function computePointsAsync(body, r0, opts = {}) {
  const { key = 'default', timeoutMs = TIMEOUT_MS } = opts;
  cancelPowerComputes(key);   // 同一路的老请求作废（其调用方收到 AbortError）

  let worker;
  try {
    worker = new Worker(new URL('./power.worker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    return Promise.reject(err);   // 环境跑不了 Worker: 直接失败
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
      if (inflight.get(key)?.cancel === cancel) inflight.delete(key);
    };
    const wrap = (fn) => (arg) => {
      if (settled) return;
      settled = true;
      finish();
      fn(arg);
    };
    const succeed = wrap(resolve);
    const fail = wrap(reject);
    function cancel() { fail(canceledError()); }

    // 主线程看门狗: Worker 自己不参与计时，超时直接终止它
    const timer = setTimeout(() => fail(new Error('发电量计算超时')), timeoutMs);

    worker.addEventListener('message', (e) => {
      if (e.data && e.data.error) fail(new Error(e.data.error));
      else succeed((e.data && e.data.points) ?? null);
    });
    worker.addEventListener('error', (e) => {
      fail(new Error((e && e.message) || '发电量计算 Worker 出错'));
    });

    inflight.set(key, { cancel });
    try {
      worker.postMessage({ id: key, body, r0 });
    } catch (err) {
      fail(isCloneError(err) ? new Error(`蓝图数据无法传给 Worker：${err.message}`) : err);
    }
  });
}
