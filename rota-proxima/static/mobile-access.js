(() => {
  let installPrompt = null;
  let installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let loginObserver = null;

  function toastSafe(message, type='') {
    if (typeof toast === 'function') return toast(message, type);
    console.info(message);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    syncInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    syncInstallButton();
    toastSafe('Rota Próxima instalado no aparelho.', 'success');
  });

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function isStandalone() {
    return installed || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function fallbackInstallInfo() {
    if (isStandalone()) {
      return toastSafe('O Rota Próxima já está instalado neste aparelho.', 'success');
    }

    if (typeof modal !== 'function') {
      return toastSafe('Use o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.');
    }

    if (isIOS()) {
      modal(`
        <div class="modal-box mobile-install-box">
          <div class="modal-head">
            <div><span class="eyebrow">Instalação</span><h2>Instalar no iPhone</h2></div>
            <button type="button" class="icon-btn modal-close">×</button>
          </div>
          <div class="info mobile-install-help">
            Abra esta página no Safari, toque em <strong>Compartilhar</strong> e escolha <strong>Adicionar à Tela de Início</strong>.
          </div>
          <div class="form-actions"><button type="button" class="btn primary modal-close">Entendi</button></div>
        </div>`);
      return;
    }

    modal(`
      <div class="modal-box mobile-install-box">
        <div class="modal-head">
          <div><span class="eyebrow">Instalação</span><h2>Instalar Rota Próxima</h2></div>
          <button type="button" class="icon-btn modal-close">×</button>
        </div>
        <div class="info mobile-install-help">
          O navegador ainda não liberou a instalação automática. Abra o menu do navegador e escolha <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.
        </div>
        <div class="form-actions"><button type="button" class="btn primary modal-close">Fechar</button></div>
      </div>`);
  }

  async function requestInstall() {
    if (isStandalone()) return fallbackInstallInfo();
    if (!installPrompt) return fallbackInstallInfo();

    try {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        installPrompt = null;
      }
      syncInstallButton();
    } catch (_) {
      fallbackInstallInfo();
    }
  }

  function syncInstallButton() {
    const button = document.getElementById('installMobileApp');
    if (!button) return false;

    const alreadyInstalled = isStandalone();
    const desiredLabel = alreadyInstalled ? 'Rota Próxima já instalado' : 'Instalar Rota Próxima no celular';
    const desiredTitle = alreadyInstalled ? 'Aplicativo já instalado' : 'Instalar aplicativo';
    const desiredText = alreadyInstalled ? 'Instalado' : 'Baixar no celular';

    button.classList.toggle('is-installed', alreadyInstalled);
    if (button.getAttribute('aria-label') !== desiredLabel) button.setAttribute('aria-label', desiredLabel);
    if (button.title !== desiredTitle) button.title = desiredTitle;

    const text = button.querySelector('b');
    if (text && text.textContent !== desiredText) text.textContent = desiredText;

    if (button.onclick !== requestInstall) button.onclick = requestInstall;
    return true;
  }

  function stopLoginObserver() {
    if (!loginObserver) return;
    loginObserver.disconnect();
    loginObserver = null;
  }

  function patchLegacyLoginAccess() {
    const existing = document.getElementById('installMobileApp');
    if (existing) {
      syncInstallButton();
      stopLoginObserver();
      return;
    }

    const loginForm = document.getElementById('loginForm');
    if (!loginForm || loginForm.dataset.mobileAccessReady === '1') return;
    const eyebrow = [...loginForm.querySelectorAll('.eyebrow')]
      .find(el => (el.textContent || '').trim().toLowerCase().startsWith('acesso'));
    if (!eyebrow) return;

    loginForm.dataset.mobileAccessReady = '1';
    const row = document.createElement('span');
    row.className = 'auth-access-row';
    eyebrow.replaceWith(row);
    row.appendChild(eyebrow);

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'installMobileApp';
    button.className = 'mobile-qr-trigger';
    button.setAttribute('aria-label', 'Instalar Rota Próxima');
    button.title = 'Instalar aplicativo';
    button.textContent = '📱';
    row.appendChild(button);
    syncInstallButton();
    stopLoginObserver();
  }

  // Observa apenas enquanto o botão legado ainda não existe. Assim que ele é
  // encontrado/criado o observer é desligado, evitando qualquer ciclo de mutação.
  loginObserver = new MutationObserver(patchLegacyLoginAccess);
  loginObserver.observe(document.documentElement, { childList: true, subtree: true });
  patchLegacyLoginAccess();
})();
