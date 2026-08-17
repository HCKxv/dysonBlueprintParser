async function loadChangelog() {
  const embedded = window.__OFFLINE_CHANGELOG__;
  if (Array.isArray(embedded)) return embedded;
  const url = new URL('../changelog.json', document.baseURI);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 将更新日志渲染进指定容器
function renderChangelog(container, changelog) {
  for (const entry of changelog ?? []) {
    const box = document.createElement('div');
    box.className = 'changelog-entry';
    const h = document.createElement('h3');
    h.textContent = entry.version ?? '';
    const ul = document.createElement('ul');
    for (const line of entry.changes ?? []) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    }
    box.appendChild(h);
    box.appendChild(ul);
    container.appendChild(box);
  }
}

// 加载并渲染更新日志；失败时在容器内显示兜底提示
function initChangelog(container) {
  loadChangelog()
    .then((data) => renderChangelog(container, data))
    .catch(() => {
      const box = document.createElement('div');
      box.className = 'changelog-entry';
      box.textContent = '更新日志加载失败';
      container.appendChild(box);
    });
}

export { initChangelog };
