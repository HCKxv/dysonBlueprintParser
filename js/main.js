import { parseBlueprintString } from './dysonSphere/blueprintParser.js';
import { computePoints, computePower } from './dysonSphere/power.js';
import { DysonSpherePreview } from './dysonSphere/preview.js';
import { createStatsPanel } from './statsPanel.js';
import { fmtKW } from './dysonSphere/lib/utils.js';
//import { stringifyBlueprint } from './dysonSphere/blueprintEncoder.js';

// ═══════════════════════════════════════════════════════════════
// 全局拖放拦截
// ═══════════════════════════════════════════════════════════════
['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
  document.body.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
});
// 阻止整个页面的中键自动滚动
document.addEventListener('mousedown', function(e) {
  if (e.button === 1) {
    e.preventDefault();
  }
});

// ═══════════════════════════════════════════════════════════════
// DOM 引用
// ═══════════════════════════════════════════════════════════════
const blueprintInput = document.getElementById('blueprintInput');
const parseButton = document.getElementById('parseButton');
const statsElement = document.getElementById('stats');
const canvas = document.getElementById('canvas3d');
const powerMain = document.getElementById('powerMain');
const radiusInput = document.getElementById('shellRadiusInput');
const lumInput = document.getElementById('luminosityInput');

// ═══════════════════════════════════════════════════════════════
// 3D 预览模块
// ═══════════════════════════════════════════════════════════════
const preview = new DysonSpherePreview();
preview.init(canvas);

// ═══════════════════════════════════════════════════════════════
// 左侧信息面板
// ═══════════════════════════════════════════════════════════════
const { renderInfoPanel, clearStats, showMessageBox } = createStatsPanel(statsElement, preview);

// ═══════════════════════════════════════════════════════════════
// 控制按钮事件
// ═══════════════════════════════════════════════════════════════
document.getElementById('gridToggle').addEventListener('change', (e) => {
  preview.setGridVisible(e.target.checked);
});
document.getElementById('rotateToggle').addEventListener('change', (e) => {
  preview.setRotationEnabled(e.target.checked);
});
document.getElementById('speedSelect').addEventListener('change', function () {
  preview.setRotationSpeed(parseFloat(this.value) || 0.05);
});

document.getElementById('pasteButton').addEventListener('click', async () => {
  try { blueprintInput.value = await navigator.clipboard.readText(); } catch { alert('无法读取剪贴板，请手动粘贴'); }
});
document.getElementById('copyButton').addEventListener('click', async () => {
  const text = blueprintInput.value.trim();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); alert('成功复制到剪贴板'); } catch { alert('无法复制到剪贴板'); }
});

// ═══════════════════════════════════════════════════════════════
// 设置菜单
// ═══════════════════════════════════════════════════════════════
const btn = document.getElementById('menuButton');
const menu = document.getElementById('powerMenu');

// 切换菜单显示/隐藏
btn.addEventListener('click', (e) => {
  btn.classList.toggle('collapsed');
  menu.classList.toggle('collapsed');
});

// ═══════════════════════════════════════════════════════════════
// 更新功率
// ═══════════════════════════════════════════════════════════════
const isNode = document.getElementById('isNode');
const isFrame = document.getElementById('isFrame');
const isFaces = document.getElementById('isFaces');
let gPowerResult = null, lastParsed = null;
// 刷新功率
const refreshPower = () => {
  if (!gPowerResult) return;
  powerMain.textContent = '⚡ ' + fmtKW(computePower(
    gPowerResult,
    parseFloat(lumInput.value) || 1.0,
    isNode.checked ?? true,
    isFrame.checked ?? true,
    isFaces.checked ?? true,
  ));
}

lumInput.addEventListener('change', () => {;
  let val = parseFloat(lumInput.value);
  if (isNaN(val)) val = 1.0;
  if (val <= 0) val = 0.1;
  if (val > 10) val = 10;
  lumInput.value = val;
  preview.setSunColor(val);
  refreshPower();
});

radiusInput.addEventListener('change', () => {
  let val = parseFloat(radiusInput.value);
  if (isNaN(val) || val < 4000) {
    val = 4000;
    radiusInput.value = val;
  }
  if (lastParsed?.body.typeId !== 1) return
  const powerResult = computePoints(lastParsed.body, val);
  if (!powerResult) return;
  gPowerResult = powerResult;
  refreshPower();
  // 重渲染信息面板（结构/细胞点数随半径变化）
  renderInfoPanel(lastParsed, powerResult);
});

[isNode, isFrame, isFaces].forEach((e) => {
  e.addEventListener('change', refreshPower);
});

// ═══════════════════════════════════════════════════════════════
// 拖放蓝图文件
// ═══════════════════════════════════════════════════════════════
const dropHint = document.getElementById('dropHint');
const textareaWrapper = blueprintInput.parentElement;

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
  blueprintInput.classList.add('drag-over');
  dropHint.classList.add('show');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  // 仅在真正离开 wrapper 时移除样式
  if (!textareaWrapper.contains(e.relatedTarget)) {
    blueprintInput.classList.remove('drag-over');
    dropHint.classList.remove('show');
  }
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  blueprintInput.classList.remove('drag-over');
  dropHint.classList.remove('show');

  const file = e.dataTransfer.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result.trim();
    if (!text) { alert('文件为空'); return; }
    if (!text.startsWith('DYBP:')) { alert('文件不是有效的蓝图文件'); return; }
    blueprintInput.value = text;
    // 自动触发解析
    parseButton.click();
  };
  reader.onerror = () => { alert('读取文件失败'); };
  reader.readAsText(file);
}

textareaWrapper.addEventListener('dragover', handleDragOver);
textareaWrapper.addEventListener('dragenter', handleDragOver);
textareaWrapper.addEventListener('dragleave', handleDragLeave);
textareaWrapper.addEventListener('drop', handleDrop);

// ═══════════════════════════════════════════════════════════════
// 蓝图解析 & 渲染
// ═══════════════════════════════════════════════════════════════
function renderFromParsed(parsed) {
  // ── 3D 渲染 ──
  preview.render(parsed.body);

  const isSingleShell = parsed.body.typeId === 1;

  // ── 单层/多层 UI ──
  document.getElementById('radiusLabel').classList.toggle('hidden', !isSingleShell);
  radiusInput.classList.toggle('hidden', !isSingleShell);

  // ── 发电量 ──
  const userRadius = parseFloat(radiusInput.value) || 10000;
  const powerResult = computePoints(parsed.body, isSingleShell ? userRadius : null);
  if (!powerResult) {
    powerMain.textContent = '⚡ 0 W';
    gPowerResult = null;
  } else {
    let lum = parseFloat(lumInput.value) || 1.0;
    if (isNaN(lum) || lum <= 0) { lum = 0.1; lumInput.value = 0.1; }
    if (lum > 10) { lum = 10; lumInput.value = 10; }
    powerMain.textContent = '⚡ ' + fmtKW(computePower(powerResult, lum));
    gPowerResult = powerResult;
    preview.setSunColor(lum);
  }

  // ── 左侧信息面板 ──
  renderInfoPanel(parsed, powerResult);
}

parseButton.addEventListener('click', async () => {
  const text = blueprintInput.value.trim();
  if (!text) return;
  parseButton.disabled = true;
  parseButton.textContent = '解析中...';
  clearStats();
  gPowerResult = lastParsed = null;
  powerMain.textContent = '⚡ 0 W';
  preview.clearScene()
  await new Promise(resolve => requestAnimationFrame(resolve)); // 等待下一帧，确保样式已经应用
  try {
    const parsed = await parseBlueprintString(text);
    renderFromParsed(parsed);
    lastParsed = parsed;
  } catch (error) {
    showMessageBox('❌ 解析失败', error.message);
  } finally {
    parseButton.disabled = false;
    parseButton.textContent = '解析并预览';
  }
});

// ═══════════════════════════════════════════════════════════════
// URL 参数加载
// ═══════════════════════════════════════════════════════════════
(async () => {
  const params = new URLSearchParams(window.location.search);
  const txtUrl = params.get('txt');
  if (txtUrl) {
    try {
      const resolved = new URL(txtUrl, window.location.href);
      const whitelist = [
        'raw.githubusercontent.com/DSPBluePrints/DysonSphereBluePrints/',
        'cdn.jsdelivr.net/gh/DSPBluePrints/DysonSphereBluePrints@main/',
      ];

      function isUrlAllowed(url, list) {
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
          } else {
            return host === entry;
          }
        });
      }

      const isWhitelist = isUrlAllowed(resolved, whitelist);
      const isSameOrigin = resolved.hostname === window.location.hostname;
      if (!isSameOrigin && !isWhitelist) {
        throw new Error('尝试加载未知的蓝图链接');
      }

      const response = await fetch(resolved.href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim().startsWith('DYBP:')) throw new Error('文件不是有效的蓝图文件');
      blueprintInput.value = text;
      parseButton.click();
    } catch (e) { clearStats(); showMessageBox('❌ 加载失败', e.message); }
  }
})();
