/**
 * Monitor page for /api/cv-position — shows raw coords and overlay mapping.
 */
(function () {
    const REF_W = 1280;
    const REF_H = 720;
    const OUT_W = 1920;
    const OUT_H = 1080;

    let pollTimer = null;

    function params() {
        return new URLSearchParams(location.search);
    }

    function pollMs() {
        const n = parseInt(params().get('poll') || '500', 10);
        return Number.isFinite(n) ? Math.max(250, Math.min(n, 5000)) : 500;
    }

    function cvApi() {
        return window.AltitudeHdCvOverlay;
    }

    function activeStreamId() {
        return cvApi()?.streamId?.() || '';
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

    function updateStreamSourceLabel(source) {
        const el = document.getElementById('cvStreamSource');
        if (!el) return;
        const labels = {
            url: 'Using stream ID from URL',
            saved: 'Using saved stream ID (this browser)',
            laptop: 'Using stream ID from CV laptop config',
            manual: 'Using stream ID you entered',
            empty: 'No stream ID yet — enter one or load from laptop',
        };
        el.textContent = labels[source] || '';
    }

    function updateVmixLinks() {
        const id = activeStreamId();
        const api = params().get('api');
        const cvLaptop = params().get('cvLaptop');

        ['cvVmixLink', 'cvKriLink'].forEach((linkId) => {
            const link = document.getElementById(linkId);
            if (!link || !id) return;
            const page = linkId === 'cvKriLink' ? 'vmix-kri.html' : 'vmix-cv-leader.html';
            const u = new URL(page, location.href);
            u.searchParams.set('streamId', id);
            if (api) u.searchParams.set('api', api);
            if (cvLaptop) u.searchParams.set('cvLaptop', cvLaptop);
            link.href = u.href;
        });
    }

    function syncStreamInput() {
        const input = document.getElementById('cvStreamInput');
        if (input) input.value = activeStreamId();
        setText('cvStreamId', activeStreamId() || '—');
        updateVmixLinks();
    }

    function applyData(data) {
        const id = activeStreamId();
        setText('cvStreamId', id || '—');
        updateVmixLinks();

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
        const id = activeStreamId();
        if (!id) {
            setStatus('waiting', 'Missing stream ID');
            showError('Enter a stream ID below, or click “Load from laptop” if CV setup is running on this PC.');
            return;
        }

        showError('');
        try {
            const data = await window.AltitudeHdCvOverlay.fetchPosition(id);
            applyData(data);
        } catch (err) {
            setStatus('waiting', 'Error');
            showError(err instanceof Error ? err.message : String(err));
            hideMarkers();
        }
    }

    function restartPoll() {
        if (pollTimer != null) clearInterval(pollTimer);
        tick();
        pollTimer = setInterval(tick, pollMs());
    }

    async function applyStreamId(id, source) {
        cvApi()?.setStreamId?.(id);
        syncStreamInput();
        updateStreamSourceLabel(source);
        restartPoll();
    }

    async function loadInitialStreamId() {
        const api = cvApi();
        if (!api) return;

        if (api.streamIdFromUrl?.()) {
            await api.ensureStreamId();
            updateStreamSourceLabel('url');
            return;
        }

        const fromLaptop = await api.fetchStreamIdFromLaptop?.();
        if (fromLaptop) {
            api.setStreamId(fromLaptop, { updateUrl: true });
            updateStreamSourceLabel('laptop');
            return;
        }

        await api.ensureStreamId();
        if (api.streamId()) {
            updateStreamSourceLabel('saved');
            return;
        }

        updateStreamSourceLabel('empty');
    }

    function bindStreamControls() {
        const form = document.getElementById('cvStreamForm');
        const input = document.getElementById('cvStreamInput');
        const laptopBtn = document.getElementById('cvStreamLaptopBtn');
        const laptopApiInput = document.getElementById('cvLaptopApiInput');

        if (laptopApiInput) {
            laptopApiInput.value = cvApi()?.laptopApiBase?.() || '';
            laptopApiInput.addEventListener('change', () => {
                const value = laptopApiInput.value.trim().replace(/\/$/, '');
                try {
                    if (value) localStorage.setItem(cvApi().LS_LAPTOP_API, value);
                    else localStorage.removeItem(cvApi().LS_LAPTOP_API);
                } catch {
                    /* ignore */
                }
            });
        }

        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = input?.value.trim() || '';
            if (!id) return;
            applyStreamId(id, 'manual');
        });

        laptopBtn?.addEventListener('click', async () => {
            const id = await cvApi()?.fetchStreamIdFromLaptop?.();
            if (!id) {
                showError(
                    `Could not read stream ID from ${cvApi()?.laptopApiBase?.()}. Start launch_cv.ps1 / cv_setup_server on this laptop.`,
                );
                return;
            }
            if (input) input.value = id;
            applyStreamId(id, 'laptop');
        });
    }

    async function init() {
        bindStreamControls();
        await loadInitialStreamId();
        syncStreamInput();
        restartPoll();
        window.addEventListener('resize', tick);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
