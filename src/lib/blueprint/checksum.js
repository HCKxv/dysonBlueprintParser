import { digest } from './md5.js';
//游戏内签名使用的并非标准 MD5，而是游戏自有的实现，见 md5.js。

// 对文本计算签名，返回大写十六进制字符串（32 位）
function computeSignature(content) {
  const bytes = new TextEncoder().encode(content);
  const hashBuffer = digest(new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

/**
 * 从蓝图字符串中提取签名与内容：<前缀><头部>"<base64>"<签名>
 * @param {string} blueprintString 蓝图字符串
 * @param {string} [prefix] 蓝图前缀（如 'DYBP:'、'BLUEPRINT:'），
 *                          传入时校验前缀，不传则不做前缀校验
 * @returns {{content: string, signature: string}|null} 结构非法时返回 null
 */
function getSignatureParts(blueprintString, prefix) {
  if (typeof blueprintString !== 'string') {
    return null;
  }

  const text = blueprintString.trim();
  if (prefix && !text.startsWith(prefix)) {
    return null;
  }

  const lastQuote = text.lastIndexOf('"');
  if (lastQuote < 0) {
    return null;
  }

  const content = text.slice(0, lastQuote); // <前缀><头部>"<base64>
  const signature = text.slice(lastQuote + 1); // <32 位十六进制签名>
  if (!/^[0-9A-Fa-f]{32}$/.test(signature)) {
    return null;
  }

  return { content, signature };
}

/**
 * 校验蓝图字符串签名
 * @param {string} blueprintString 蓝图字符串
 * @param {string} [prefix] 蓝图前缀，传入时同时校验前缀
 * @returns {boolean}
 */
function verifyBlueprintString(blueprintString, prefix) {
  const parts = getSignatureParts(blueprintString, prefix);
  if (!parts) return false;
  return parts.signature.toUpperCase() === computeSignature(parts.content);
}

export {
  computeSignature,
  getSignatureParts,
  verifyBlueprintString,
};
