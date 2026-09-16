(() => {
  let installPrompt = null;
  let promptInFlight = false;
  let installed = false;
  let loginObserver = null;

  function standaloneMediaMatches() {
    try {
      return typeof window.matchMedia === 'function'
        && window.matchMedia('(display-mode: standalone)').matches;
    } catch (_) {
      return false;
    }
  }

  installed = standaloneMediaMatches() || window.navigator?.standalone === true;

  function toastSafe(message, type = '') {
    try {
      if (typeof toast === 'function') return toast(message, type);
    } catch (_) {}
    console.info(message);
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(window.navigator?.userAgent || '');
  }

  function isAndroid() {
    return /android/i.test(window.navigator?.userAgent || '');
  }

  function isStandalone() {
    return installed || standaloneMediaMatches() || window.navigator?.standalone === true;
  }

  function showInstallHelp() {
    if (isStandalone()) {
      toastSafe('O Rota Próxima já está instalado neste aparelho.', 'success');
      return;
    }

    const ios = isIOS();
    const heading = ios ? 'Instalar no iPhone' : 'Instalar Rota Próxima';
    const steps = ios
      ? '<ol class="mobile-install-steps"><li>Abra esta página no <strong>Safari</strong>.</li><li>Toque em <strong>Compartilhar</strong>.</li><li>Escolha <strong>Adicionar à Tela de Início</strong>.</li></ol>'
      : isAndroid()
        ? '<ol class="mobile-install-steps"><li>Abra o menu <strong>⋮</strong> do Chrome.</li><li>Toque em <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.</li><li>Confirme a instalação.</li></ol>'
        : '<ol class="mobile-install-steps"><li>Abra o menu do navegador.</li><li>Escolha <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.</li><li>Confirme para criar o acesso no aparelho.</li></ol>';

    const markup = `
      <div class="modal-box mobile-install-box">
        <div class="modal-head">
          <div><span class="eyebrow">Acesso no celular</span><h2>${heading}</h2></div>
          <button type="button" class="icon-btn modal-close" aria-label="Fechar">×</button>
        </div>
        <div class="info mobile-install-help">O Rota Próxima pode ser adicionado à tela inicial para abrir como aplicativo.</div>
        ${steps}
        <div class="form-actions"><button type="button" class="btn primary modal-close">Fechar</button></div>
      </div>`;

    try {
      if (typeof modal === 'function') {
        const dialog = document.getElementById('modal');
        if (dialog?.open) dialog.close();
        modal(markup);
        return;
      }
    } catch (_) {}

    toastSafe(ios
      ? 'No Safari: Compartilhar → Adicionar à Tela de Início.'
      : 'Abra o menu do navegador e escolha “Instalar aplicativo”.');
  }

  async function requestInstall(event) {
    event?.preventDefault?.();
    if (promptInFlight) return;
    if (isStandalone()) return showInstallHelp();
    if (!installPrompt) return showInstallHelp();

    const prompt = installPrompt;
    promptInFlight = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        installPrompt = null;
      } else {
        // O evento pode ser usado novamente enquanto a página continuar aberta.
        installPrompt = prompt;
      }
    } catch (_) {
      installPrompt = prompt;
      showInstallHelp();
    } finally {
      promptInFlight = false;
      syncInstallButton();
    }
  }

  function bindInstallButton(button) {
    if (!button || button.dataset.mobileAccessBound === '1') return;
    button.addEventListener('click', requestInstall);
    button.dataset.mobileAccessBound = '1';
  }

  function syncInstallButton() {
    const button = document.getElementById('installMobileApp');
    if (!button) return false;

    bindInstallButton(button);
    const alreadyInstalled = isStandalone();
    const desiredLabel = alreadyInstalled ? 'Rota Próxima já instalado' : 'Instalar Rota Próxima no celular';
    const desiredTitle = alreadyInstalled ? 'Aplicativo já instalado' : 'Instalar aplicativo';
    const desiredText = alreadyInstalled ? 'Instalado' : 'Baixar no celular';

    button.classList.toggle('is-installed', alreadyInstalled);
    if (button.getAttribute('aria-label') !== desiredLabel) button.setAttribute('aria-label', desiredLabel);
    if (button.title !== desiredTitle) button.title = desiredTitle;

    const text = button.querySelector('b');
    if (text && text.textContent !== desiredText) text.textContent = desiredText;
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

  window.addEventListener('pageshow', syncInstallButton);
  document.addEventListener('visibilitychange', syncInstallButton);

  // O botão já vem no HTML atual. O observer fica apenas como compatibilidade
  // para versões antigas do login e é desligado assim que encontra o botão.
  if (typeof MutationObserver === 'function') {
    loginObserver = new MutationObserver(patchLegacyLoginAccess);
    loginObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  patchLegacyLoginAccess();
})();
