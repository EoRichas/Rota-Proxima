(() => {
  const nativeFetch = window.fetch.bind(window);
  const STARTUP_PATHS = new Set(['/api/me', '/api/setup-status']);
  const HEALTH_TIMEOUT_MS = 8000;
  const WARMUP_LIMIT_MS = 70000;
  const DASHBOARD_LIMIT_MS = 40000;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function sameOriginPath(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return '';
      return url.pathname;
    } catch (_) {
      return '';
    }
  }

  function setAuthStatus(message) {
    const el = document.getElementById('authStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function setPageStatus(message) {
    const label = document.querySelector('#page .rp-loader-label');
    if (label) {
      label.textContent = message;
      return;
    }
    const empty = document.querySelector('#page .empty');
    if (empty && /^carregando/i.test(empty.textContent.trim())) empty.textContent = message;
  }

  function jsonError(message, status = 503) {
    return new Response(JSON.stringify({error: message}), {
      status,
      headers: {'Content-Type': 'application/json; charset=utf-8'},
    });
  }

  async function healthAttempt() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await nativeFetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {'X-Rota-Warmup': '1'},
        signal: controller.signal,
      });
      return response.ok;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function warmServer() {
    const startedAt = Date.now();
    let attempt = 0;
    setAuthStatus('Conectando ao servidor...');

    while (Date.now() - startedAt < WARMUP_LIMIT_MS) {
      attempt += 1;
      if (attempt > 1) setAuthStatus('Acordando o servidor do Render...');
      if (await healthAttempt()) {
        setAuthStatus('Servidor disponível. Verificando sua sessão...');
        return true;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= 15000) setAuthStatus('O servidor está iniciando. Isso pode levar alguns segundos no plano gratuito...');
      await sleep(Math.min(1200 + attempt * 300, 3500));
    }

    setAuthStatus('O servidor demorou para iniciar. Tente novamente em alguns instantes.');
    return false;
  }

  let warmupPromise = warmServer();

  async function startupFetch(input, init) {
    const ready = await warmupPromise;
    if (!ready) return jsonError('O servidor demorou para iniciar. Tente novamente.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const safeInit = {...(init || {}), signal: controller.signal};
    try {
      return await nativeFetch(input, safeInit);
    } catch (error) {
      if (error?.name === 'AbortError') return jsonError('O servidor não respondeu à verificação de acesso.', 504);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function dashboardFetch(input, init) {
    const controller = new AbortController();
    const startedAt = Date.now();
    const sourceSignal = init?.signal;
    const forwardAbort = () => controller.abort();
    if (sourceSignal) sourceSignal.addEventListener('abort', forwardAbort, {once: true});

    const statusTimer = setTimeout(() => setPageStatus('Conectando aos dados...'), 6000);
    const slowTimer = setTimeout(() => setPageStatus('Aguardando resposta do Supabase...'), 18000);
    const hardTimer = setTimeout(() => controller.abort(), DASHBOARD_LIMIT_MS);

    try {
      return await nativeFetch(input, {...(init || {}), signal: controller.signal});
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      if (error?.name === 'AbortError' && elapsed >= DASHBOARD_LIMIT_MS - 1000) {
        return jsonError('O dashboard demorou para responder. Use “Tentar novamente”.', 504);
      }
      throw error;
    } finally {
      clearTimeout(statusTimer);
      clearTimeout(slowTimer);
      clearTimeout(hardTimer);
      if (sourceSignal) sourceSignal.removeEventListener('abort', forwardAbort);
    }
  }

  window.fetch = function rotaResilientFetch(input, init) {
    const path = sameOriginPath(input);
    if (STARTUP_PATHS.has(path)) return startupFetch(input, init);
    if (path === '/api/dashboard' || path === '/api/dashboard-pending') return dashboardFetch(input, init);
    return nativeFetch(input, init);
  };

  window.addEventListener('online', () => {
    warmupPromise = warmServer();
  });
})();
