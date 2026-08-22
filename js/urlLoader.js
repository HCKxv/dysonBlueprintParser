const DEFAULT_WHITELIST = [
  'raw.githubusercontent.com/DSPBluePrints/DysonSphereBluePrints/',
  'cdn.jsdelivr.net/gh/DSPBluePrints/DysonSphereBluePrints@main/',
];

function isUrlAllowed(url, list = DEFAULT_WHITELIST) {
  const host = url.hostname;
  const path = url.pathname;
  return list.some(entry => {
    if (entry.includes('/')) {
      const slash = entry.indexOf('/');
      const entryHost = entry.slice(0, slash);
      let entryPath = entry.slice(slash);
      if (!entryPath.endsWith('/')) {
        entryPath += '/';
      }
      return host === entryHost && (path + '/').startsWith(entryPath);
    }
    return host === entry;
  });
}

async function loadBlueprintFromUrl({ input, onLoaded, onError }) {
  const params = new URLSearchParams(window.location.search);
  const txtUrl = params.get('txt');
  if (!txtUrl) return false;

  try {
    const resolved = new URL(txtUrl, window.location.href);
    const isWhitelist = isUrlAllowed(resolved);
    const isSameOrigin = resolved.hostname === window.location.hostname;
    if (!isSameOrigin && !isWhitelist) {
      throw new Error('未知的蓝图链接');
    }

    const response = await fetch(resolved.href);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim().startsWith('DYBP:')) throw new Error('文件不是有效的蓝图文件');
    input.value = text;
    onLoaded?.();
    return true;
  } catch (e) {
    onError?.(e);
    return false;
  }
}

export { loadBlueprintFromUrl }
