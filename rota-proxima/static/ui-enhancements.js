(() => {
  const THEME_KEY = 'rota_proxima_theme_v1';
  const SIDEBAR_KEY = 'rota_proxima_sidebar_v1';

  const icons = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 15a8 8 0 1 1 16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 15l4-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="15" r="1.7" fill="currentColor"/></svg>',
    pevs: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" stroke="currentColor" stroke-width="2"/><path d="M9.2 10.6h5.6M10.2 8.6l3.6 4M13.8 8.6l-3.6 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    requests: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5h8M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="2"/><rect x="5" y="5" width="14" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M9 10h6M9 14h4M18 15v6M15 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    planner: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 18c2-6 5-8 9-8h3" stroke="currentColor" stroke-width="2" stroke-dasharray="2 2" stroke-linecap="round"/><path d="M17 6a3 3 0 1 1 6 0c0 2.6-3 5-3 5s-3-2.4-3-5Z" transform="translate(-2 0)" stroke="currentColor" stroke-width="1.7"/><circle cx="5" cy="18" r="2" stroke="currentColor" stroke-width="2"/></svg>',
    routes: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 18c2-6 5-8 10-8" stroke="currentColor" stroke-width="2" stroke-dasharray="2 2" stroke-linecap="round"/><path d="M15 6a3 3 0 1 1 6 0c0 2.6-3 5-3 5s-3-2.4-3-5Z" stroke="currentColor" stroke-width="1.7"/><path d="M2 17a3 3 0 1 1 6 0c0 2.6-3 5-3 5s-3-2.4-3-5Z" stroke="currentColor" stroke-width="1.7"/></svg>',
    driver: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="2"/><path d="M5 10h14M9 19l3-7 3 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    production: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 20V10l5 3V9l5 3V5h5v15H3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M17 3h2M17 7h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="17" r="3" stroke="currentColor" stroke-width="1.7"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 11a7 7 0 1 0 2-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="2"/><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="17" cy="9" r="2" stroke="currentColor" stroke-width="1.7"/><path d="M16 14c2.8 0 5 1.6 5 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" stroke-width="2"/><path d="M14 3v5h5M9 16v2M12 13v5M15 10v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  function sunMoonMarkup() {
    return '<label class="rp-theme-switch" title="Alternar modo claro/escuro" aria-label="Alternar modo claro/escuro">' +
      '<input id="rpThemeToggle" type="checkbox">' +
      '<span class="rp-theme-track"><span class="rp-theme-thumb">' +
      '<svg class="rp-theme-sun" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<svg class="rp-theme-moon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" fill="currentColor"/></svg>' +
      '</span></span></label>';
  }

  function loaderMarkup(label = 'Carregando...') {
    return '<div class="rp-page-loader"><div><div class="rp-loader"><div class="rp-truck-wrapper">' +
      '<div class="rp-truck-body"><svg viewBox="0 0 198 93" fill="none" aria-hidden="true">' +
      '<path stroke-width="3" stroke="#27332e" fill="#257956" d="M135 22.5H177.264C178.295 22.5 179.22 23.133 179.594 24.0939L192.33 56.8443C192.442 57.1332 192.5 57.4404 192.5 57.7504V89C192.5 90.3807 191.381 91.5 190 91.5H135C133.619 91.5 132.5 90.3807 132.5 89V25C132.5 23.6193 133.619 22.5 135 22.5Z"/>' +
      '<path stroke-width="3" stroke="#27332e" fill="#8ea79c" d="M146 33.5H181.741C182.779 33.5 183.709 34.1415 184.078 35.112L190.538 52.112C191.16 53.748 189.951 55.5 188.201 55.5H146C144.619 55.5 143.5 54.3807 143.5 53V36C143.5 34.6193 144.619 33.5 146 33.5Z"/>' +
      '<rect stroke-width="3" stroke="#27332e" fill="#dfe9e4" rx="2.5" height="90" width="121" y="1.5" x="6.5"/>' +
      '<rect stroke-width="2" stroke="#27332e" fill="#f5efb8" rx="1" height="7" width="5" y="63" x="187"/>' +
      '</svg></div>' +
      '<div class="rp-truck-tires"><svg viewBox="0 0 30 30" aria-hidden="true"><circle stroke-width="3" stroke="#27332e" fill="#27332e" r="13.5" cy="15" cx="15"/><circle fill="#dfe9e4" r="7" cy="15" cx="15"/></svg><svg viewBox="0 0 30 30" aria-hidden="true"><circle stroke-width="3" stroke="#27332e" fill="#27332e" r="13.5" cy="15" cx="15"/><circle fill="#dfe9e4" r="7" cy="15" cx="15"/></svg></div>' +
      '<div class="rp-road"></div><svg class="rp-lamp-post" viewBox="0 0 40 100" aria-hidden="true"><path fill="currentColor" d="M22 2c-7 0-12 5-12 12v5H8v4h5v75h6V23h10v-4H16v-5c0-3.5 2.5-6 6-6s6 2.5 6 6h6C34 7 29 2 22 2Z"/><circle cx="13" cy="24" r="8" fill="currentColor"/></svg>' +
      '</div></div><div class="rp-loader-label">' + String(label).replace(/[&<>"']/g, '') + '</div></div></div>';
  }

  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (_) {}
    const toggle = document.getElementById('rpThemeToggle');
    if (toggle) toggle.checked = dark;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#081812' : '#13251f';
  }

  function currentTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (_) {}
    return 'light';
  }

  function decorateNavigation() {
    document.querySelectorAll('#nav button[data-page]').forEach(button => {
      if (button.querySelector('.nav-icon')) return;
      const page = button.dataset.page || '';
      const label = button.textContent.trim();
      button.textContent = '';
      const icon = document.createElement('span');
      icon.className = 'nav-icon';
      icon.innerHTML = icons[page] || icons.routes;
      const text = document.createElement('span');
      text.className = 'nav-label';
      text.textContent = label;
      button.append(icon, text);
    });
  }

  function enhanceUserCard() {
    const card = document.getElementById('currentUserCard');
    if (!card || !state?.user) return;
    if (card.classList.contains('enhanced-user-card')) {
      applyTheme(currentTheme());
      return;
    }
    card.classList.add('enhanced-user-card');
    card.innerHTML = '<div class="user-card-top"><div class="user-card-copy"><strong>' + esc(state.user.name) + '</strong><span>@' + esc(state.user.username) + '</span></div>' + sunMoonMarkup() + '</div><button id="myPasswordBtn" class="btn ghost small">Minha senha</button>';
    const password = document.getElementById('myPasswordBtn');
    if (password) password.onclick = () => openPasswordModal(false);
    const toggle = document.getElementById('rpThemeToggle');
    if (toggle) {
      toggle.checked = currentTheme() === 'dark';
      toggle.onchange = event => applyTheme(event.currentTarget.checked ? 'dark' : 'light');
    }
    applyTheme(currentTheme());
  }

  function ensureCollapseButton() {
    const sidebar = document.getElementById('sidebar');
    const footer = sidebar?.querySelector('.sidebar-footer');
    const shell = document.getElementById('appShell');
    if (!sidebar || !footer || !shell || sidebar.querySelector('.sidebar-collapse-toggle')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sidebar-collapse-toggle';
    button.title = 'Recolher/expandir menu';
    button.setAttribute('aria-label', 'Recolher ou expandir menu lateral');
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    sidebar.insertBefore(button, footer);
    let collapsed = false;
    try { collapsed = localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch (_) {}
    shell.classList.toggle('sidebar-collapsed', collapsed);
    button.onclick = () => {
      const next = !shell.classList.contains('sidebar-collapsed');
      shell.classList.toggle('sidebar-collapsed', next);
      try { localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded'); } catch (_) {}
    };
  }

  function fixPlannerDate() {
    const input = document.getElementById('routeDate');
    if (!input || input.dataset.creationDateFixed === '1') return;
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    input.value = local;
    input.dataset.creationDateFixed = '1';
    const name = document.getElementById('routeName');
    if (name && /^Rota\s+\d{1,2}\/\d{1,2}\/\d{4}$/.test(name.value.trim())) {
      name.value = 'Rota ' + now.toLocaleDateString('pt-BR');
    }
  }

  function replaceGenericLoading() {
    if (!state?.user) return;
    const page = document.getElementById('page');
    if (!page || page.querySelector('.rp-page-loader')) return;
    const text = page.textContent.trim().toLowerCase();
    if (text === 'carregando...' || text === 'carregando…') {
      page.innerHTML = loaderMarkup('Carregando...');
    }
  }

  applyTheme(currentTheme());

  const observer = new MutationObserver(() => {
    if (!document.getElementById('appShell')?.classList.contains('hidden')) {
      decorateNavigation();
      enhanceUserCard();
      ensureCollapseButton();
      fixPlannerDate();
      replaceGenericLoading();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => {
    decorateNavigation();
    enhanceUserCard();
    ensureCollapseButton();
    fixPlannerDate();
    replaceGenericLoading();
  });
})();
