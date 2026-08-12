import { parseBlueprintString, quaternionToOrbitParams, isVisible } from './dysonBlueprintParser.js';
import { computePoints, computePower } from './dysonSpherePower.js';
import { DysonSpherePreview } from './DysonSpherePreview.js';
//import { stringifyBlueprint } from './dysonBlueprintEncoder.js';

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
// 统计面板
// ═══════════════════════════════════════════════════════════════
function addStat(label, value, parent) {
  const box = document.createElement('div');
  box.className = 'stat-box';
  box.innerHTML = `<strong>${label}</strong><br>${value}`;
  (parent || statsElement).appendChild(box);
  return box;
}

function addStatToggle(layerType, id, label, value, defChecked, parent) {
  const box = document.createElement('div');
  box.className = 'stat-box';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = defChecked;
  cb.className = 'stat-checkbox';
  cb.addEventListener('change', () => preview.setLayerVisible(layerType, id, cb.checked));
  box.appendChild(cb);
  const span = document.createElement('span');
  span.innerHTML = `<strong>${label}</strong><br>${value}`;
  box.appendChild(span);
  (parent || statsElement).appendChild(box);
  return box;
}

function addCollapsibleSection(title, count) {
  const section = document.createElement('div');
  section.className = 'stat-section';
  const header = document.createElement('div');
  header.className = 'stat-section-header collapsed';
  header.innerHTML = `<span class="arrow">▼</span> ${title} (${count})`;
  const body = document.createElement('div');
  body.className = 'stat-section-body collapsed';
  header.addEventListener('click', () => {
    header.classList.toggle('collapsed');
    body.classList.toggle('collapsed');
  });
  section.appendChild(header);
  section.appendChild(body);
  statsElement.appendChild(section);
  return body;
}

function clearStats() { statsElement.innerHTML = ''; }

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════
const fmtKW = (kw) => {
  if (kw < 0) return '???';
  if (kw === 0) return '0 W';
  if (kw < 1) return formatValue(kw * 1000) + ' W';  // 一般也有可能不太出现小数
  if (kw >= 1e12) return formatValue(kw / 1e12) + ' PW';
  if (kw >= 1e9) return formatValue(kw / 1e9) + ' TW';
  if (kw >= 1e6) return formatValue(kw / 1e6) + ' GW';
  if (kw >= 1e3) return formatValue(kw / 1e3) + ' MW';
  return formatValue(kw) + ' kW';
};

const formatValue = (value) => {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
};

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
let gPowerResult = null, lastParsed = null, singleShellStatBox = null;
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
  if (lastParsed?.body.typeId !== 1) return
  let val = parseFloat(radiusInput.value);
  if (isNaN(val) || val < 4000) {
    val = 4000;
    radiusInput.value = val;
  }
  const powerResult = computePoints(lastParsed.body, val);
  if (!powerResult) return;
  gPowerResult = powerResult;
  refreshPower();
  // 更新统计面板
  const layer = powerResult.layers[0];
  if (layer) {
    const sh = lastParsed.body.singleShell;
    const nCnt = sh?.nodes ? sh.nodes.filter(Boolean).length : 0;
    const fCnt = sh?.frames ? sh.frames.filter(Boolean).length : 0;
    const fcCnt = sh?.faces ? sh.faces.filter(Boolean).length : 0;
    const box = singleShellStatBox;
    if (box) box.innerHTML = '<strong>单层壳</strong><br>节点' + nCnt + ' 框架' + fCnt + ' 壳面' + fcCnt + '<br>结构点数' + ((layer?.totalNodeSP || 0) + (layer?.totalFrameSP || 0)) + ' / 细胞点数' + (layer?.totalCP || 0);
  }
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
  const cloud = parsed.body.dysonCloud;
  const shell = isSingleShell
    ? { shells: [parsed.body.singleShell], orbitList: [{ id: 0, radius: 10000.0, x: 0, y: 0, z: 0, w: 1 }] }
    : (parsed.body.dysonShell ?? null);

  // ── 填充网格警告 ──
  if (shell?.orbitList) {
    let hasFillGridWarning = false;
    for (const orbit of shell.orbitList) {
      if (!orbit) continue;
      const shData = shell.shells?.[orbit.id] ?? null;
      if (!hasFillGridWarning && shData?.fillGrid?.colors) {
        for (const cc of shData.fillGrid.colors) { if (cc && cc.a) { hasFillGridWarning = true; break; } }
      }
    }
    if (hasFillGridWarning) addStat('<span class="text-warning">⚠ 此蓝图含有网格涂色</span> ', '当前不支持网格涂色，颜色可能无法正确显示');
  }

  // ── 单层/多层 UI ──
  document.getElementById('radiusLabel').classList.toggle('hidden', !isSingleShell);
  radiusInput.classList.toggle('hidden', !isSingleShell);
  //if (isSingleShell) radiusInput.value = 10000;

  // ── 发电量 ──
  const userRadius = radiusInput.value || 10000;
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

  // ── 蓝图信息 ──
  addStat('蓝图信息',
    '蓝图类型：' + (parsed.header.typeName || '未知') + '<br>' +
    '蓝图版本：' + parsed.header.version + '<br>' +
    '创建时间：' + parsed.header.createdAt + '<br>' +
    '应力系统等级需求：等级 ' + (Math.min(6, Math.max(0, Math.ceil((parsed.header.latLimit || 0) / 15))))
  );

  if (! isSingleShell){
    addStat('建造',
      '总结构点数：' + ((powerResult?.totalNodeSP || 0) + (powerResult?.totalFrameSP || 0)) + '<br>' +
      '总细胞点数：' + (powerResult?.totalCP || 0)
    )
  }

  // ── 云轨道统计 ──
  if (cloud?.orbits) {
    const sortedOrbits = cloud.orbits.filter(Boolean).sort((a, b) => a.id - b.id);
    const body = addCollapsibleSection('云轨道', sortedOrbits.length);
    sortedOrbits.forEach((orb) => {
      const op = quaternionToOrbitParams(orb);
      const ed = cloud.visibility ? !!isVisible(cloud.visibility.editor, orb.id) : true;
      const gv = cloud.visibility ? !!isVisible(cloud.visibility.inGame, orb.id) : true;
      const val = '半径 ' + orb.radius.toFixed(0) + ' / 倾角 ' + op.inclination.toFixed(1) + '° / 升交点 ' + op.ascendingNode.toFixed(1) + '°' + '<br>编辑器' + (ed ? '显示' : '不显示') + ' / 游戏内' + (gv ? '显示' : '不显示');
      addStatToggle('cloud', orb.id, '云轨道 ' + orb.id, val, gv, body);
    });
  }

  // ── 壳层统计 ──
  if (shell?.orbitList) {
    const sortedOrbits = shell.orbitList.filter(Boolean).sort((a, b) => a.id - b.id);
    if (isSingleShell) {
      for (const orbit of sortedOrbits) {
        const shData = shell.shells?.[orbit.id] ?? null;
        const nodeCnt = shData?.nodes ? shData.nodes.filter(Boolean).length : 0;
        const frameCnt = shData?.frames ? shData.frames.filter(Boolean).length : 0;
        const faceCnt = shData?.faces ? shData.faces.filter(Boolean).length : 0;
        const layerData = powerResult?.layers.find(l => l.orbitId === orbit.id);
        singleShellStatBox = addStat('单层壳', '节点' + nodeCnt + ' 框架' + frameCnt + ' 壳面' + faceCnt + '<br>结构点数' + ((layerData?.totalNodeSP || 0) + (layerData?.totalFrameSP || 0)) + ' / 细胞点数' + (layerData?.totalCP || 0));
      }
    } else {
      const body = addCollapsibleSection('壳层', sortedOrbits.length);
      for (const orbit of sortedOrbits) {
        const shData = shell.shells?.[orbit.id] ?? null;
        const nodeCnt = shData?.nodes ? shData.nodes.filter(Boolean).length : 0;
        const frameCnt = shData?.frames ? shData.frames.filter(Boolean).length : 0;
        const faceCnt = shData?.faces ? shData.faces.filter(Boolean).length : 0;
        const ed = shell.visibility ? !!isVisible(shell.visibility.editor, orbit.id) : true;
        const gv = shell.visibility ? !!isVisible(shell.visibility.inGame, orbit.id) : true;
        const layerData = powerResult?.layers.find(l => l.orbitId === orbit.id);
        const op = quaternionToOrbitParams(orbit);
        const val = '半径 ' + orbit.radius.toFixed(0) + ' / 倾角 ' + op.inclination.toFixed(1) + '° / 升交点 ' + op.ascendingNode.toFixed(1) + '°' + '<br>节点' + nodeCnt + ' / 框架' + frameCnt + ' / 壳面' + faceCnt + '<br>结构点数' + ((layerData?.totalNodeSP || 0) + (layerData?.totalFrameSP || 0)) + ' / 细胞点数' + (layerData?.totalCP || 0) + '<br>编辑器' + (ed ? '显示' : '不显示') + ' / 游戏内' + (gv ? '显示' : '不显示');
        addStatToggle('shell', orbit.id, '壳层 ' + orbit.id, val, gv, body);
      }
    }
  }
}

parseButton.addEventListener('click', async () => {
  const text = blueprintInput.value.trim();
  if (!text) return;
  parseButton.disabled = true;
  parseButton.textContent = '解析中...';
  clearStats();
  gPowerResult = lastParsed = singleShellStatBox = null;
  powerMain.textContent = '⚡ 0 W';
  preview.clearScene()
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    const parsed = await parseBlueprintString(text);
    renderFromParsed(parsed);
    lastParsed = parsed;
  } catch (error) {
    addStat('❌ 解析失败', error.message);
  }
  parseButton.disabled = false;
  parseButton.textContent = '解析并预览';
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
    } catch (e) { clearStats(); addStat('❌ 加载失败', e.message); }
  }
})();
