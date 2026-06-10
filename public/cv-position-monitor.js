/**
 * Monitor page for /api/cv-position — shows raw coords and overlay mapping.
 */
(function () {
    const REF_W = 1280;
    const REF_H = 720;
    const OUT_W = 1920;
    const OUT_H = 1080;

    function params() {
        return new URLSearchParams(location.search);
    }

    function streamId() {
        return (
            params().get('streamId') ||
            params().get('gpsId') ||
            params().get('id') ||
            ''
        ).trim();
    }

    function pollMs() {
        const n = parseInt(params().get('poll') || '500', 10);
        return Number.isFinite(n) ? Math.max(250, Math.min(n, 5000)) : 500;
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function formatTime(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return '—';
        return new Date(ms).toLocaleTimeString();
    }

    function setStatus(mode, label) {
        const badge = document.getElementById('cvStatusBadge');
        const text = document.getElementById('cvStatusText');
        if (badge) {
            badge.className = `cv-monitor__status cv-monitor__status--${mode}`;
        }
        if (text) text.textContent = label;
    }

    function showError(message) {
        const el = document.getElementById('cvError');
        if (!el) return;
        if (message) {
            el.hidden = false;
            el.textContent = message;
        } else {
            el.hidden = true;
            el.textContent = '';
        }
    }

    function applyData(data) {
        const id = streamId();
        setText('cvStreamId', id || '—');

        const vmixLink = document.getElementById('cvVmixLink');
        if (vmixLink && id) {
            const u = new URL('vmix-cv-leader.html', location.href);
            u.searchParams.set('streamId', id);
            const api = params().get('api');
            if (api) u.searchParams.set('api', api);
            vmixLink.href = u.href;
        }

        if (!data) {
            setStatus('waiting', 'No data yet');
            hideMarkers();
            clearStats();
            return;
        }

        const refW = Number(data.refW) || REF_W;
        const refH = Number(data.refH) || REF_H;
        const offset = data.offset || window.AltitudeHdCvOverlay.venueOffset(data.venue);
        const overlay = window.AltitudeHdCvOverlay.mapPoint(data.x, data.y, refW, refH, offset);

        setText('cvCoords', `${data.x}, ${data.y}`);
        setText('cvOverlayX', `${Math.round(overlay.left)} px`);
        setText('cvFrame', String(data.frame ?? '—'));
        setText('cvAuto', data.auto ? 'On' : 'Off');
        setText('cvOffset', `${offset.x}, ${offset.y} (${data.venue || 'karapiro'})`);
        setText('cvAge', `${Math.round(Number(data.ageMs) || 0)} ms`);
        setText('cvUpdated', formatTime(Number(data.updatedAt)));

        placeCrosshair(data.x, data.y, refW, refH);
        placeOverlayLine(overlay.left);

        if (data.stale) {
            setStatus('stale', 'Stale — no recent CV updates');
        } else {
            setStatus('live', 'Live');
        }
    }

    function clearStats() {
        ['cvCoords', 'cvOverlayX', 'cvFrame', 'cvAuto', 'cvOffset', 'cvAge', 'cvUpdated'].forEach((id) => {
            setText(id, '—');
        });
    }

    function hideMarkers() {
        document.getElementById('cvCrosshair')?.classList.remove('cv-monitor__crosshair--visible');
        document.getElementById('cvOverlayLine')?.classList.remove('cv-monitor__line--visible');
    }

    function placeCrosshair(x, y, refW, refH) {
        const el = document.getElementById('cvCrosshair');
        const box = document.getElementById('cvPreview');
        if (!el || !box) return;

        const rect = box.getBoundingClientRect();
        const left = (Number(x) / refW) * rect.width;
        const top = (Number(y) / refH) * rect.height;
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.classList.add('cv-monitor__crosshair--visible');
    }

    function placeOverlayLine(leftPx) {
        const el = document.getElementById('cvOverlayLine');
        const box = document.getElementById('cvOverlayPreview');
        if (!el || !box) return;

        const rect = box.getBoundingClientRect();
        const left = (Number(leftPx) / OUT_W) * rect.width;
        el.style.left = `${left}px`;
        el.classList.add('cv-monitor__line--visible');
    }

    async function tick() {
        const id = streamId();
        if (!id) {
            setStatus('waiting', 'Missing streamId');
            showError('Add ?streamId=YOUR_GPS_ID to the URL.');
            return;
        }

        showError('');
        try {
            const data = await window.AltitudeHdCvOverlay.fetchPosition();
            applyData(data);
        } catch (err) {
            setStatus('waiting', 'Error');
            showError(err instanceof Error ? err.message : String(err));
            hideMarkers();
        }
    }

    function init() {
        const id = streamId();
        if (id) setText('cvStreamId', id);

        tick();
        setInterval(tick, pollMs());
        window.addEventListener('resize', tick);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
