/**
 * statsPanel — 左侧蓝图信息面板
 *
 * 用法: const { renderInfoPanel, clearStats, showMessageBox } = createStatsPanel(statsElement, preview);
 *
 * 面板内容由 buildStatsTree 以纯数据节点树描述，再经通用渲染函数生成 DOM。
 * 节点: { kind:'stat', label, value }
 *       { kind:'toggle', layerType, id, label, value, checked }
 *       { kind:'section', title, count, children: Node[] }
 */
import { quaternionToOrbitParams, isVisible, gridTypeName, countPaintedCells } from './dysonBlueprintParser.js';

function createStatsPanel(statsElement, preview) {

  // ═══════════════════════════════════════════════════════════════
  // 数据构建（纯函数，返回节点树）
  // ═══════════════════════════════════════════════════════════════
  function countComponents(list) {
    return list ? list.filter(Boolean).length : 0;
  }

  // 轨道参数行（半径/倾角/升交点）
  function fmtOrbitLine(orbit) {
    const op = quaternionToOrbitParams(orbit);
    return '半径 ' + orbit.radius.toFixed(0) + ' / 倾角 ' + op.inclination.toFixed(1) + '° / 升交点 ' + op.ascendingNode.toFixed(1) + '°';
  }

  // 可见性行
  function fmtVisibilityLine(ed, gv) {
    return '编辑器' + (ed ? '显示' : '不显示') + ' / 游戏内' + (gv ? '显示' : '不显示');
  }

  // 壳层核心统计内容（单层壳/多层壳共用）
  function fmtShellValue(shData, layerData) {
    const nodeCnt = countComponents(shData?.nodes);
    const frameCnt = countComponents(shData?.frames);
    const faceCnt = countComponents(shData?.faces);
    const paintCnt = countPaintedCells(shData?.fillGrid?.colors);
    const structPts = (layerData?.totalNodeSP || 0) + (layerData?.totalFrameSP || 0);
    const cellPts = layerData?.totalCP || 0;
    const lines = [
      '节点' + nodeCnt + ' / 框架' + frameCnt + ' / 壳面' + faceCnt,
      '结构点数' + structPts + ' / 细胞点数' + cellPts,
      '网格涂色：' + (paintCnt ? gridTypeName(shData.fillGrid.gridType) + ' / ' + paintCnt : '无'),
    ];
    return lines.join('<br>');
  }

  function buildStatsTree(parsed, powerResult) {
    const nodes = [];
    const singleShell = parsed.body.singleShell;
    const cloud = parsed.body.dysonCloud;
    const shell = parsed.body.dysonShell;

    // ── 蓝图信息 ──
    nodes.push({
      kind: 'stat', label: '蓝图信息',
      value: '蓝图类型：' + (parsed.header.typeName || '未知') + '<br>' +
        '蓝图版本：' + parsed.header.version + '<br>' +
        '创建时间：' + parsed.header.createdAt + '<br>' +
        '应力系统等级需求：等级 ' + (Math.min(6, Math.max(0, Math.ceil((parsed.header.latLimit || 0) / 15)))),
    });

    // ── 建造总量 ──
    if ([2, 4].includes(parsed.body.typeId)) {
      nodes.push({
        kind: 'stat', label: '建造',
        value: '总结构点数：' + ((powerResult?.totalNodeSP || 0) + (powerResult?.totalFrameSP || 0)) + '<br>' +
          '总细胞点数：' + (powerResult?.totalCP || 0),
      });
    }

    // ── 云轨道 ──
    if (cloud?.orbits) {
      const orbits = cloud.orbits.filter(Boolean).sort((a, b) => a.id - b.id);
      nodes.push({
        kind: 'section', title: '云轨道', count: orbits.length,
        children: orbits.map((orb) => {
          const ed = cloud.visibility ? !!isVisible(cloud.visibility.editor, orb.id) : true;
          const gv = cloud.visibility ? !!isVisible(cloud.visibility.inGame, orb.id) : true;
          return {
            kind: 'toggle', layerType: 'cloud', id: orb.id, label: '云轨道 ' + orb.id,
            value: fmtOrbitLine(orb) + '<br>' + fmtVisibilityLine(ed, gv),
            checked: gv,
          };
        }),
      });
    }

    // ── 壳层 ──
    if (singleShell) {
      nodes.push({
        kind: 'stat', label: '单层壳',
        value: fmtShellValue(singleShell, powerResult?.layers?.[0] ?? null),
      });
    } else if (shell?.orbitList) {
      const orbits = shell.orbitList.filter(Boolean).sort((a, b) => a.id - b.id);
      const items = orbits.map((orbit) => {
        const shData = shell.shells?.[orbit.id] ?? null;
        const layerData = powerResult?.layers.find((l) => l.orbitId === orbit.id);
        const ed = shell.visibility ? !!isVisible(shell.visibility.editor, orbit.id) : true;
        const gv = shell.visibility ? !!isVisible(shell.visibility.inGame, orbit.id) : true;
        return {
          kind: 'toggle', layerType: 'shell', id: orbit.id, label: '壳层 ' + orbit.id,
          value: [
            fmtOrbitLine(orbit),
            fmtShellValue(shData, layerData),
            fmtVisibilityLine(ed, gv),
          ].join('<br>'),
          checked: gv,
        };
      });
      nodes.push({ kind: 'section', title: '壳层', count: orbits.length, children: items });
    }

    return nodes;
  }

  // ═══════════════════════════════════════════════════════════════
  // 渲染（通用，节点树 → DOM）
  // ═══════════════════════════════════════════════════════════════
  function renderStatNode(node, parent) {
    const box = document.createElement('div');
    box.className = 'stat-box';
    if (node.kind === 'toggle') {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = node.checked;
      cb.className = 'stat-checkbox';
      cb.addEventListener('change', () => preview.setLayerVisible(node.layerType, node.id, cb.checked));
      box.appendChild(cb);
      const span = document.createElement('span');
      span.innerHTML = '<strong>' + node.label + '</strong><br>' + node.value;
      box.appendChild(span);
    } else {
      box.innerHTML = '<strong>' + node.label + '</strong><br>' + node.value;
    }
    (parent || statsElement).appendChild(box);
    return box;
  }

  function renderSectionNode(node, parent) {
    const section = document.createElement('div');
    section.className = 'stat-section';
    const header = document.createElement('div');
    header.className = 'stat-section-header collapsed';
    header.innerHTML = '<span class="arrow">▼</span> ' + node.title + ' (' + node.count + ')';
    const body = document.createElement('div');
    body.className = 'stat-section-body collapsed';
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      body.classList.toggle('collapsed');
    });
    section.appendChild(header);
    section.appendChild(body);
    (parent || statsElement).appendChild(section);
    for (const child of node.children) {
      if (child.kind === 'section') renderSectionNode(child, body);
      else renderStatNode(child, body);
    }
    return body;
  }

  function renderInfoPanel(parsed, powerResult) {
    clearStats();
    for (const node of buildStatsTree(parsed, powerResult)) {
      if (node.kind === 'section') renderSectionNode(node);
      else renderStatNode(node);
    }
  }

  function clearStats() { statsElement.innerHTML = ''; }

  function showMessageBox(label, message) {
    const box = document.createElement('div');
    box.className = 'stat-box';
    box.innerHTML = '<strong>' + label + '</strong><br>' + message;
    statsElement.appendChild(box);
  }

  return { renderInfoPanel, clearStats, showMessageBox };
}

export { createStatsPanel };
