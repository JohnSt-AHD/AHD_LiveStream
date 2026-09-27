/**
 * Bottom-right CrewSight walk-up QR on RowSafe map (no-GPS logbook check-in).
 */
(function () {
  const fab = document.getElementById('rowsafeWalkupQr');
  const img = document.getElementById('rowsafeWalkupQrImg');
  const link = document.getElementById('rowsafeWalkupQrLink');
  if (!fab || !img || !link) return;

  async function load() {
    try {
      const res = await fetch('/api/walkup-link', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.walkupUrl) {
        fab.hidden = true;
        return;
      }
      const url = String(data.walkupUrl);
      link.href = url;
      img.src =
        'https://api.qrserver.com/v1/create-qr-code/?size=192x192&margin=8&data=' +
        encodeURIComponent(url);
      img.alt = 'QR code: start a logbook session (no GPS)';
      fab.hidden = false;
    } catch {
      fab.hidden = true;
    }
  }

  load();
})();
