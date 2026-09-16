(() => {
  const nativeFetch = window.fetch.bind(window);

  function sameOriginPath(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin ? url.pathname : '';
    } catch (_) {
      return '';
    }
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {'Content-Type': 'application/json; charset=utf-8'},
    });
  }

  async function fetchWithDeadline(input, init, timeoutMs, fallback) {
    const controller = new AbortController();
    const upstream = init?.signal;
    const forwardAbort = () => controller.abort();
    if (upstream) upstream.addEventListener('abort', forwardAbort, {once: true});
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await nativeFetch(input, {...(init || {}), signal: controller.signal});
    } catch (error) {
      if (error?.name === 'AbortError' && typeof fallback === 'function') return fallback();
      throw error;
    } finally {
      clearTimeout(timer);
      if (upstream) upstream.removeEventListener('abort', forwardAbort);
    }
  }

  window.fetch = function rotaFailFastFetch(input, init) {
    const path = sameOriginPath(input);

    // A checagem de sessão nunca pode bloquear a tela de login.
    if (path === '/api/me') {
      return fetchWithDeadline(input, init, 7000, () => jsonResponse({user: null, session_timeout: true}));
    }

    // O sistema já está configurado em produção; em indisponibilidade temporária,
    // mantenha o login utilizável em vez de prender a página no primeiro acesso.
    if (path === '/api/setup-status') {
      return fetchWithDeadline(input, init, 5000, () => jsonResponse({needs_setup: false, setup_timeout: true}));
    }

    if (path === '/api/login') {
      return fetchWithDeadline(input, init, 20000, () => jsonResponse({error: 'O login demorou para responder. Tente novamente.'}, 504));
    }

    if (path === '/api/dashboard' || path === '/api/dashboard-pending') {
      return fetchWithDeadline(input, init, 25000, () => jsonResponse({error: 'O dashboard demorou para responder. Tente novamente.'}, 504));
    }

    return nativeFetch(input, init);
  };

  function forceLoginReady() {
    const auth = document.getElementById('authScreen');
    const app = document.getElementById('appShell');
    const login = document.getElementById('loginForm');
    const setup = document.getElementById('setupForm');
    const status = document.getElementById('authStatus');

    if (!auth || !app || !login) return;
    if (app.classList.contains('hidden') && !auth.classList.contains('hidden')) {
      login.classList.remove('hidden');
      setup?.classList.add('hidden');
      if (status) {
        status.textContent = '';
        status.classList.add('hidden');
      }
    }
  }

  // Watchdog visual: mesmo que algum script externo falhe, o usuário nunca fica
  // indefinidamente olhando “Conectando ao servidor...”.
  setTimeout(forceLoginReady, 9000);
})();
