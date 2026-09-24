/**
 * Hub: Regatta NZ spectator-app management (Setup).
 * Depends on regatta-nz-config.js and hub-csv helpers when present.
 */
(function () {
    const CFG = () => window.AltitudeHdRegattaNzConfig;
    const ROWIT_BASES = [
        'https://l.rowit.nz/altitude',
        'https://rowit.nz/altitude',
    ];
    const ROWIT_FILES = [
        { id: 'daysheet', label: 'Daysheet' },
        { id: 'competitors', label: 'Competitors' },
        { id: 'results', label: 'Results' },
        { id: 'events', label: 'Events' },
    ];

    function $(id) {
        return document.getElementById(id);
    }

    function setCheckStatus(row, state, message) {
        const icon = row?.querySelector('.hub-csv-status');
        if (!icon) return;
        icon.classList.remove(
            'hub-csv-status--ok',
            'hub-csv-status--fail',
            'hub-csv-status--pending',
        );
        if (state === 'ok') {
            icon.classList.add('hub-csv-status--ok');
            icon.textContent = '✓';
            icon.title = message || 'OK';
        } else if (state === 'fail') {
            icon.classList.add('hub-csv-status--fail');
            icon.textContent = '✕';
            icon.title = message || 'Failed';
        } else {
            icon.classList.add('hub-csv-status--pending');
            icon.textContent = '…';
            icon.title = message || 'Checking…';
        }
        const detail = row.querySelector('.hub-rnz-check-detail');
        if (detail) detail.textContent = message || '';
    }

    function readForm() {
        const modeEl = document.querySelector('input[name="hubRnzMode"]:checked');
        return {
            code: ($('hubRnzCode')?.value || '').trim(),
            livestreamUrl: ($('hubRnzLivestreamUrl')?.value || '').trim(),
            livestreamActive: Boolean($('hubRnzLivestreamActive')?.checked),
            livestreamLabel: ($('hubRnzLivestreamLabel')?.value || '').trim(),
            mode: modeEl?.value === 'live' ? 'live' : 'sim',
            streamId: ($('hubRnzStreamId')?.value || '').trim() || 'ged-sim',
        };
    }

    function fillForm(cfg) {
        if ($('hubRnzCode')) $('hubRnzCode').value = cfg.code || '';
        if ($('hubRnzLivestreamUrl')) $('hubRnzLivestreamUrl').value = cfg.livestreamUrl || '';
        if ($('hubRnzLivestreamActive')) $('hubRnzLivestreamActive').checked = Boolean(cfg.livestreamActive);
        if ($('hubRnzLivestreamLabel')) {
            $('hubRnzLivestreamLabel').value = cfg.livestreamLabel || 'Watch the livestream';
        }
        if ($('hubRnzStreamId')) $('hubRnzStreamId').value = cfg.streamId || 'ged-sim';
        const sim = document.querySelector('input[name="hubRnzMode"][value="sim"]');
        const live = document.querySelector('input[name="hubRnzMode"][value="live"]');
        if (sim && live) {
            if (cfg.mode === 'live') live.checked = true;
            else sim.checked = true;
        }
        updateOpenLink(cfg);
        updateModeHint(cfg.mode);
    }

    function updateOpenLink(cfg) {
        const a = $('hubRnzOpenApp');
        if (!a) return;
        const code = CFG()?.normalizeCode?.(cfg.code) || cfg.code || 'nzmm2026';
        a.href = `regatta-nz/?regatta=${encodeURIComponent(code)}`;
    }

    function updateModeHint(mode) {
        const el = $('hubRnzModeHint');
        if (!el) return;
        el.textContent =
            mode === 'live'
                ? 'Live: spectator Live tab expects real CV/drone feeds (not GED sim).'
                : 'Simulation: spectator Live tab uses GED CV sim (/api/race).';
    }

    function syncHubRegattaCodeInput(code) {
        const hubCode = $('hubRegattaCode');
        if (!hubCode) return;
        const c = CFG()?.normalizeCode?.(code) || code;
        if (!c || hubCode.value === c) return;
        hubCode.value = c;
        hubCode.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function saveFromForm() {
        const api = CFG();
        if (!api) return null;
        const saved = api.save(readForm());
        fillForm(saved);
        syncHubRegattaCodeInput(saved.code);
        const status = $('hubRnzSaveStatus');
        if (status) {
            status.textContent = `Saved · ${saved.code} · ${saved.mode}`;
            status.hidden = false;
        }
        // Push to shared API so the phone APK (different browser) can read it.
        publishRemoteConfig(saved, status);
        return saved;
    }

    async function publishRemoteConfig(saved, statusEl) {
        try {
            const res = await fetch('/api/regatta-nz-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(saved),
                cache: 'no-store',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            if (statusEl) {
                const where = data.persisted ? 'synced to app' : 'synced (session)';
                statusEl.textContent = `Saved · ${saved.code} · ${saved.mode} · ${where}`;
            }
        } catch (e) {
            if (statusEl) {
                statusEl.textContent = `Saved locally · app sync failed (${e.message || e})`;
            }
        }
    }

    async function probeJson(url, okFn) {
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            return { ok: false, message: `HTTP ${res.status}` };
        }
        if (okFn) {
            const verdict = okFn(data, res);
            if (verdict && typeof verdict === 'object') return verdict;
            if (verdict === false) return { ok: false, message: 'Unexpected response' };
        }
        return { ok: true, message: 'OK' };
    }

    async function checkApis(cfg) {
        const mode = cfg.mode || 'sim';
        const streamId = cfg.streamId || 'ged-sim';

        const raceRow = $('hubRnzCheckRace');
        const cvRow = $('hubRnzCheckCv');
        const droneRow = $('hubRnzCheckDrone');

        setCheckStatus(raceRow, 'pending');
        setCheckStatus(cvRow, 'pending');
        setCheckStatus(droneRow, 'pending');

        try {
            const race = await probeJson('/api/race', (data) => {
                if (!data || data.ok === false) return { ok: false, message: 'No race payload' };
                if (mode === 'sim') {
                    return data.sim
                        ? { ok: true, message: `GED sim · ${data.race_phase || 'ok'}` }
                        : { ok: true, message: `Live race feed · ${data.race_phase || 'ok'}` };
                }
                if (data.sim) {
                    return {
                        ok: false,
                        message: 'Still GED sim — switch CV to live or leave Simulation on',
                    };
                }
                return { ok: true, message: `Live · ${data.race_phase || 'ok'}` };
            });
            setCheckStatus(raceRow, race.ok ? 'ok' : 'fail', race.message);
        } catch (e) {
            setCheckStatus(raceRow, 'fail', e.message || 'Unreachable');
        }

        try {
            const q =
                mode === 'sim'
                    ? `/api/cv-position?streamId=${encodeURIComponent(streamId || 'ged-sim')}&sim=1`
                    : `/api/cv-position?streamId=${encodeURIComponent(streamId)}`;
            const cv = await probeJson(q, (data) => {
                if (!data || data.error) {
                    return { ok: false, message: data?.error || 'No position' };
                }
                if (mode === 'sim') {
                    return {
                        ok: true,
                        message: data.sim ? 'Sim position OK' : `Position · age ${data.ageMs ?? '?'}ms`,
                    };
                }
                if (data.stale) {
                    return { ok: false, message: `Stale (${data.ageMs ?? '?'}ms)` };
                }
                if (data.sim) {
                    return { ok: false, message: 'Got sim position — waiting for live CV ingest' };
                }
                return { ok: true, message: `Fresh · age ${data.ageMs ?? 0}ms` };
            });
            setCheckStatus(cvRow, cv.ok ? 'ok' : 'fail', cv.message);
        } catch (e) {
            setCheckStatus(cvRow, 'fail', e.message || 'Unreachable');
        }

        try {
            const drone = await probeJson('/api/drone-telemetry', (data) => {
                if (!data || typeof data !== 'object') {
                    return { ok: false, message: 'Empty telemetry' };
                }
                const lat = Number(data.latitude ?? data.lat);
                const hasFix = Number.isFinite(lat);
                if (mode === 'sim') {
                    return {
                        ok: true,
                        message: data.sim ? 'GED sim drone OK' : hasFix ? 'Telemetry OK' : 'Responding',
                    };
                }
                if (data.sim) {
                    return { ok: false, message: 'Still sim drone telemetry' };
                }
                return hasFix
                    ? { ok: true, message: 'Live drone telemetry' }
                    : { ok: false, message: 'No GPS fix yet' };
            });
            setCheckStatus(droneRow, drone.ok ? 'ok' : 'fail', drone.message);
        } catch (e) {
            setCheckStatus(droneRow, 'fail', e.message || 'Unreachable');
        }
    }

    function isCsvLike(text) {
        const t = String(text || '')
            .replace(/^\uFEFF/, '')
            .trim();
        if (t.length < 20 || !t.includes(',')) return false;
        if (/^<!doctype html/i.test(t) || /<html[\s>]/i.test(t)) return false;
        if (/nothing published/i.test(t)) return false;
        return /event|race|day |competitor|lane_/i.test(t);
    }

    async function checkCsvViaApi(url) {
        try {
            const res = await fetch(`/api/check-csv?url=${encodeURIComponent(url)}`, {
                signal: AbortSignal.timeout(12000),
            });
            const data = await res.json();
            if (data && typeof data.ok === 'boolean') return data;
        } catch {
            /* fall through */
        }
        return { ok: false };
    }

    async function checkLocalPath(path) {
        try {
            const res = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
            if (!res.ok) return { ok: false, status: res.status };
            const text = await res.text();
            return { ok: isCsvLike(text), bytes: text.length, local: true };
        } catch {
            return { ok: false };
        }
    }

    async function checkRowit(cfg) {
        const code = CFG()?.normalizeCode?.(cfg.code) || cfg.code;
        for (const file of ROWIT_FILES) {
            const row = $(`hubRnzCheckRowit_${file.id}`);
            if (!row) continue;
            setCheckStatus(row, 'pending');
            let last = { ok: false };
            for (const base of ROWIT_BASES) {
                const url = `${base}/${code}/${file.id}.csv`;
                last = await checkCsvViaApi(url);
                if (last.ok) {
                    setCheckStatus(
                        row,
                        'ok',
                        `RowIT OK (${last.bytes ?? 'CSV'} bytes)`,
                    );
                    break;
                }
            }
            if (last.ok) continue;
            const localLive = await checkLocalPath(`data/rowit-live/${code}/${file.id}.csv`);
            if (localLive.ok) {
                setCheckStatus(row, 'ok', `Local rowit-live (${localLive.bytes} bytes)`);
                continue;
            }
            const localArchive = await checkLocalPath(
                `data/archives/${code}/latest/${file.id}.csv`,
            );
            if (localArchive.ok) {
                setCheckStatus(row, 'ok', `Local archive (${localArchive.bytes} bytes)`);
                continue;
            }
            setCheckStatus(
                row,
                'fail',
                last.error || (last.status ? `HTTP ${last.status}` : 'Not published'),
            );
        }
    }

    async function runHealthChecks() {
        const cfg = saveFromForm() || CFG()?.load() || {};
        const btn = $('hubRnzCheckBtn');
        if (btn) btn.disabled = true;
        try {
            await Promise.all([checkApis(cfg), checkRowit(cfg)]);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function init() {
        if (!CFG() || !$('hubRegattaNzPanel')) return;

        fillForm(CFG().load());

        $('hubRnzSave')?.addEventListener('click', () => {
            saveFromForm();
        });
        $('hubRnzCheckBtn')?.addEventListener('click', () => {
            runHealthChecks();
        });

        document.querySelectorAll('input[name="hubRnzMode"]').forEach((el) => {
            el.addEventListener('change', () => {
                updateModeHint(el.value);
            });
        });

        $('hubRnzCode')?.addEventListener('change', () => {
            updateOpenLink(readForm());
        });

        document.addEventListener('altitudehd:urls', () => {
            const hubCode = $('hubRegattaCode')?.value;
            if (hubCode && $('hubRnzCode') && !$('hubRnzCode').matches(':focus')) {
                $('hubRnzCode').value = CFG().normalizeCode(hubCode);
                updateOpenLink(readForm());
            }
        });

        document.addEventListener('altitudehd:regatta-nz', (e) => {
            if (e?.detail) fillForm(e.detail);
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
