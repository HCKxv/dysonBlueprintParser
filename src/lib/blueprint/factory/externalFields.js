/**
 * 自定义属性字段（externalFields）的转义与拆解
 */

/** 去掉字段里不允许的换行/制表符 */
export function validateFieldText(s) {
  const text = String(s ?? '');
  if (!/[\n\r\t\u2028\u2029]/.test(text)) return text;
  return text.replace(/[\n\r\t\u2028\u2029]/g, '');
}

/** 内容 → 存进 externalFields 的写法 */
export function escapeExternalField(s) {
  const text = String(s ?? '');
  if (!/[\\;:]/.test(text)) return text;
  let out = '';
  for (const ch of text) {
    if (ch === '\\') out += '\\\\';
    else if (ch === ';') out += '\\b';
    else if (ch === ':') out += '\\c';
    else out += ch;
  }
  return out;
}

/** externalFields 里的写法 → 内容 */
export function unescapeExternalField(s) {
  const text = String(s ?? '');
  if (!text.includes('\\')) return text;
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\' && i < text.length - 1) {
      const next = text[i + 1];
      i += 1;
      if (next === '\\') out += '\\';
      else if (next === 'b') out += ';';
      else if (next === 'c') out += ':';
      else out += `\\${next}`;
    } else {
      out += text[i];
    }
  }
  return out;
}

/** `名称:值;名称:值;` → [{ key, value }] */
export function parseExternalFields(raw) {
  const text = validateFieldText(raw);
  if (!text) return [];
  const entries = text.split(';');

  const list = [];
  for (let i = 0; i < entries.length - 1; i += 1) {
    const parts = entries[i].split(':');
    if (parts.length !== 2) continue;
    list.push({
      key: unescapeExternalField(parts[0]),
      value: unescapeExternalField(parts[1]),
    });
  }
  return list;
}

/** [{ key, value }] → `名称:值;名称:值;` */
export function buildExternalFields(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list
    .map((prop) => {
      const key = escapeExternalField(validateFieldText(prop?.key));
      const value = escapeExternalField(validateFieldText(prop?.value));
      return `${key}:${value}`;
    })
    .join(';') + ';';
}
