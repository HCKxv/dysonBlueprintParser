/**
 * shellLayer.worker — 在 Worker 线程里算整层壳的几何
 */
import { computeLayerGeometry } from './shellLayerCompute.js';

self.onmessage = (e) => {
  let layer;
  try {
    layer = computeLayerGeometry(e.data.shData, e.data.orbit, e.data.scale);
  } catch (err) {
    self.postMessage({ error: (err && err.message) ? err.message : String(err) });
    return;
  }
  const { nodes, frames, cells, painting } = layer;
  const buffers = new Set();
  const add = (arr) => { if (arr && arr.buffer) buffers.add(arr.buffer); };
  add(nodes.ids); add(nodes.positions); add(nodes.colors);
  add(frames.positions); add(frames.colors); add(frames.indices); add(frames.backIndices);
  for (const b of cells ?? []) {
    add(b.positions); add(b.normals); add(b.colors); add(b.patternUV); add(b.patternMN); add(b.indices);
  }
  for (const p of painting ?? []) { add(p.positions); add(p.colors); }
  // 用 Set 去重: 同一个 ArrayBuffer 出现两次会让 postMessage 抛 DataCloneError
  self.postMessage({ layer }, [...buffers]);
};
