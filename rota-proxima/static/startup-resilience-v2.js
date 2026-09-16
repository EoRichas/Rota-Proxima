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

  window.fetch = function rotaNoPreloadFetch(input, init) {
    const path = sameOriginPath(input);

    // O login deve aparecer imediatamente. Não fazemos nenhuma viagem ao backend
    // durante o primeiro desenho da tela.
    if (path === '/api/me') {
      return Promise.resolve(jsonResponse({user: null, skipped_preload: true}));
    }
    if (path === '/api/setup-status') {
      return Promise.resolve(jsonResponse({needs_setup: false, skipped_preload: true}));
    }

    // A primeira chamada real ao servidor acontece somente quando o usuário entra.
    if (path === '/api/login') {
      return fetchWithDeadline(input, init, 20000, () =>
        jsonResponse({error: 'O servidor demorou para responder ao login. Tente novamente.'}, 504)
      );
    }

    if (path === '/api/dashboard' || path === '/api/dashboard-pending') {
      return fetchWithDeadline(input, init, 25000, () =>
        jsonResponse({error: 'O dashboard demorou para responder. Tente novamente.'}, 504)
      );
    }

    return nativeFetch(input, init);
  };

  function keepLoginVisible() {
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

  // O formulário nasce utilizável, independentemente do estado da API.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', keepLoginVisible, {once: true});
  } else {
    keepLoginVisible();
  }
  setTimeout(keepLoginVisible, 50);
  setTimeout(keepLoginVisible, 500);
})();
