(() => {
  const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  function routeIdFromDialog(dialog) {
    const eyebrow = dialog?.querySelector('.eyebrow');
    const match = String(eyebrow?.textContent || '').match(/Rota\s*#(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function locationCardHost(dialog) {
    const monitor = dialog?.querySelector('.route-monitor-card');
    if (!monitor) return null;
    let host = monitor.querySelector('[data-last-location-address]');
    if (host) return host;
    host = document.createElement('div');
    host.dataset.lastLocationAddress = '1';
    host.className = 'route-last-location';
    host.innerHTML = `
      <span class="eyebrow">Última localização recebida</span>
      <strong>Consultando endereço...</strong>
      <span class="muted">A posição exibida corresponde à última leitura enviada pelo aparelho do motorista.</span>`;
    const timeline = monitor.querySelector('#routeLiveTimeline');
    if (timeline) monitor.insertBefore(host, timeline);
    else monitor.appendChild(host);
    return host;
  }

  async function hydrate(dialog) {
    if (!dialog?.open) return;
    const routeId = routeIdFromDialog(dialog);
    if (!routeId) return;
    const host = locationCardHost(dialog);
    if (!host || host.dataset.loadedRoute === String(routeId)) return;
    host.dataset.loadedRoute = String(routeId);

    try {
      const data = await api(`/api/routes/${routeId}/last-location-address`, {timeoutMs: 15000});
      const last = data?.last_location;
      if (!last) {
        host.innerHTML = `
          <span class="eyebrow">Última localização recebida</span>
          <strong>Sem localização registrada</strong>
          <span class="muted">O aparelho do motorista ainda não enviou uma posição para esta rota.</span>`;
        return;
      }

      const label = last.address?.label || 'Endereço não identificado';
      const when = last.recorded_at ? DATE_FMT.format(new Date(last.recorded_at)) : 'horário não informado';
      const accuracy = Number(last.accuracy_m);
      const accuracyText = Number.isFinite(accuracy) && accuracy > 0
        ? ` • precisão aproximada: ${Math.round(accuracy)} m`
        : '';
      host.innerHTML = `
        <span class="eyebrow">Última localização recebida</span>
        <strong>${esc(label)}</strong>
        <span>${esc(when)}${esc(accuracyText)}</span>
        <span class="muted">${last.address?.approximate ? 'Endereço aproximado por geocodificação reversa. ' : ''}Não representa rastreamento em tempo real.</span>`;
    } catch (error) {
      if (error?.status === 403) {
        host.remove();
        return;
      }
      host.innerHTML = `
        <span class="eyebrow">Última localização recebida</span>
        <strong>Não foi possível converter a posição em endereço.</strong>
        <span class="muted">A coordenada permanece registrada internamente no histórico da rota.</span>`;
    }
  }

  const observer = new MutationObserver(() => {
    const dialog = document.getElementById('modal');
    if (dialog?.open) hydrate(dialog);
  });

  observer.observe(document.documentElement, {childList: true, subtree: true});
  document.addEventListener('click', () => {
    const dialog = document.getElementById('modal');
    if (dialog?.open) setTimeout(() => hydrate(dialog), 0);
  });
})();
