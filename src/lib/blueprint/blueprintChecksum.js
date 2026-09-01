import { digest } from './md5.js';
// 游戏内蓝图签名使用的并非标准 MD5，而是游戏自有的

// 球体蓝图字符串固定前缀
const BLUEPRINT_PREFIX = 'DYBP:';

// 对文本计算 MD5 签名，返回大写十六进制字符串
function computeSignature(content) {
  const bytes = new TextEncoder().encode(content);
  const hashBuffer = digest(new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

// 从蓝图中提取签名和内容：DYBP:<header>"<base64>"<signature>
function getSignatureParts(blueprintString) {
  if (typeof blueprintString !== 'string') {
    return null;
  }

  const text = blueprintString.trim();
  if (!text.startsWith(BLUEPRINT_PREFIX)) {
    return null;
  }

  const lastQuote = text.lastIndexOf('"');
  if (lastQuote < 0) {
    return null;
  }

  const content = text.slice(0, lastQuote);
  const signature = text.slice(lastQuote + 1);

  if (!signature) {
    return null;
  }

  return {
    content,  // DYBP:<header>"<base64>
    signature, // <signature>
  };
}

function verifyBlueprintString(blueprintString) {
  const parts = getSignatureParts(blueprintString);
  if (!parts) return false;
  const { content, signature } = parts;

  if (signature === computeSignature(content)) {
    return true;
  }
  return false;
}

export {
  computeSignature,
  getSignatureParts,
  verifyBlueprintString,
};
