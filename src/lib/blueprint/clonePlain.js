/**
 * 深拷贝成「纯数据」
 *
 * 蓝图数据可能被 Vue 的响应式包成代理（reactive / computed 读出来的对象都是），
 * 而代理是克隆不了的: structuredClone 会抛
 *   DataCloneError: Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned
 * 所以拷贝走「能 structuredClone 就结构化克隆（快），不能就递归拷贝成纯对象/纯数组」。
 */

/** 递归拷贝成纯对象 / 纯数组（剥掉所有响应式代理） */
export function toPlainCopy(value) {
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      out[i] = toPlainCopy(value[i]);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = toPlainCopy(value[key]);
    }
    return out;
  }
  return value;
}

/** 深拷贝: 优先原生 structuredClone，数据里混入响应式代理等不可克隆对象时退回纯数据递归拷贝 */
export function cloneData(value) {
  try {
    return structuredClone(value);
  } catch {
    return toPlainCopy(value);
  }
}
