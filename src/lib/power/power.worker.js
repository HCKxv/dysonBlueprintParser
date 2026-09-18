/**
 * power.worker — 在 Worker 线程里算戴森球的点数（computePoints）
 *
 * 只负责收发：请求 { id, body, r0 }，应答 { id, points } 或 { id, error }。
 * 生命周期（超时 / 取消 / 终止）由主线程的 powerAsync.js 管。
 */
import { computePoints } from './power.js';

self.onmessage = (e) => {
  const { id, body, r0 } = e.data || {};
  try {
    self.postMessage({ id, points: computePoints(body, r0) });
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) ? err.message : String(err) });
  }
};
