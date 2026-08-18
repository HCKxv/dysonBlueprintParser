async function loadChangelog() {
  const embedded = window.__OFFLINE_CHANGELOG__;
  if (Array.isArray(embedded)) return embedded;
  const url = new URL('./changelog.json', document.baseURI);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function initChangelog(container) {
  loadChangelog()
    .then((data) => {
      for (const entry of data ?? []) {
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
    })
    .catch(() => {
      const box = document.createElement('div');
      box.className = 'changelog-entry';
      box.textContent = '更新日志加载失败';
      container.appendChild(box);
    });
}

(() => {
  initChangelog(document.getElementById('changelogBody'));
  const changelogModal = document.getElementById('changelogModal');
  const closeChangelog = () => changelogModal.classList.add('hidden');
  document.getElementById('changelogLink').addEventListener('click', (e) => {
    e.preventDefault();
    changelogModal.classList.remove('hidden');
  });
  document.getElementById('changelogClose').addEventListener('click', closeChangelog);
  document.getElementById('changelogBackdrop').addEventListener('click', closeChangelog);
})();
