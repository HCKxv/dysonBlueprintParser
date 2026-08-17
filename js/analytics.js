(function () {
  const footer = document.getElementById('footerBar');
  if (footer) {
    const pv = document.createElement('span');
    pv.id = 'vercount_value_page_pv';
    pv.textContent = '0';
    const uv = document.createElement('span');
    uv.id = 'vercount_value_site_uv';
    uv.textContent = '0';
    const box = document.createElement('div');
    box.append(pv, document.createTextNode(' / '), uv);
    footer.append(document.createTextNode(' | '), box);
  }

  const s = document.createElement('script');
  s.src = 'https://events.vercount.one/js';
  s.defer = true;
  document.head.appendChild(s);
})();
