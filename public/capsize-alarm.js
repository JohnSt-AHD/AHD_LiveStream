/**
 * Capsize / sudden-stop alarm for rowing safety maps.
 * Detects Traccar alarm attributes or a sudden stop after recent boat speed.
 */
(function (global) {
    const LS_STATE = 'altitudeHdCapsizeState_v1';
    const LS_ACK = 'altitudeHdCapsizeAck_v1';

    const MOVING_SPEED_MPS = 1.2;
    const STOPPED_SPEED_MPS = 0.35;
    const MOVING_LOOKBACK_MS = 12 * 60 * 1000;
    const STOPPED_CONFIRM_MS = 45 * 1000;
    const MAX_FIX_AGE_MS = 3 * 60 * 1000;

    let audioCtx = null;
    let lastSoundAt = 0;

    function loadJson(key, fallback) {
        try {
            const raw = global.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    function saveJson(key, value) {
        try {
            global.localStorage.setItem(key, JSON.stringify(value));
        } catch {
            /* ignore */
        }
    }

    function fixAgeMs(fixTime) {
        const t = fixTime ? new Date(fixTime).getTime() : 0;
        if (!t || Number.isNaN(t)) return Number.POSITIVE_INFINITY;
        return Date.now() - t;
    }

    function readAlarm(pos) {
        const attrs = pos?.attributes;
        if (!attrs || typeof attrs !== 'object') return null;
        const raw = attrs.alarm || attrs.Alarm || attrs.event || attrs.sos;
        if (typeof raw !== 'string') return null;
        if (/capsize|cap.?size|flip|overturn|sos|panic|distress|emergency/i.test(raw)) {
            return raw;
        }
        return null;
    }

    function playAlarmTone() {
        const now = Date.now();
        if (now - lastSoundAt < 8000) return;
        lastSoundAt = now;
        try {
            const Ctx = global.AudioContext || global.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
            const t0 = audioCtx.currentTime;
            for (let i = 0; i < 3; i++) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.value = i % 2 === 0 ? 880 : 660;
                gain.gain.setValueAtTime(0.0001, t0 + i * 0.35);
                gain.gain.exponentialRampToValueAtTime(0.22, t0 + i * 0.35 + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.28);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(t0 + i * 0.35);
                osc.stop(t0 + i * 0.35 + 0.3);
            }
        } catch {
            /* ignore */
        }
    }

    function updateCapsizeAlerts(devices, positions) {
        const state = loadJson(LS_STATE, {});
        const ack = loadJson(LS_ACK, {});
        const now = Date.now();
        const active = [];
        const nextState = { ...state };
        const deviceIds = new Set((devices || []).map((d) => d.id));

        for (const id of Object.keys(nextState)) {
            if (!deviceIds.has(Number(id))) delete nextState[id];
        }

        for (const d of devices || []) {
            const pos = positions[d.id];
            if (!pos) {
                delete nextState[d.id];
                continue;
            }

            const fixAge = fixAgeMs(pos.fixTime);
            const speed = typeof pos.speed === 'number' && !Number.isNaN(pos.speed) ? pos.speed : 0;
            const traccarAlarm = readAlarm(pos);
            let entry = nextState[d.id] || {};

            if (speed >= MOVING_SPEED_MPS && fixAge <= MOVING_LOOKBACK_MS) {
                entry.lastMovingAt = now;
            }

            if (speed <= STOPPED_SPEED_MPS && fixAge <= MAX_FIX_AGE_MS) {
                if (!entry.stoppedSince) entry.stoppedSince = now;
            } else {
                entry.stoppedSince = null;
            }

            nextState[d.id] = entry;

            const stoppedLong =
                entry.stoppedSince && now - entry.stoppedSince >= STOPPED_CONFIRM_MS;
            const wasMovingRecently =
                entry.lastMovingAt && now - entry.lastMovingAt <= MOVING_LOOKBACK_MS;
            const suddenStop = wasMovingRecently && stoppedLong && fixAge <= MAX_FIX_AGE_MS;

            if (traccarAlarm || suddenStop) {
                const alertId = `${d.id}:${traccarAlarm ? 'alarm' : 'stop'}`;
                if (ack[alertId]) continue;
                active.push({
                    alertId,
                    deviceId: d.id,
                    deviceName: d.name || `Device ${d.id}`,
                    pos,
                    reason: traccarAlarm
                        ? `Device alarm: ${traccarAlarm}`
                        : `Sudden stop after rowing (${speed.toFixed(1)} m/s) — possible capsize`,
                });
            }
        }

        saveJson(LS_STATE, nextState);
        if (active.length) playAlarmTone();
        return active;
    }

    function acknowledgeCapsizeAlert(alertId) {
        const ack = loadJson(LS_ACK, {});
        ack[alertId] = Date.now();
        saveJson(LS_ACK, ack);
    }

    function renderCapsizePanel(container, alerts, onAck) {
        if (!container) return;
        const box = document.getElementById('safetyCapsizeBox');
        if (!alerts.length) {
            if (box) box.hidden = true;
            container.innerHTML = '';
            return;
        }
        if (box) {
            box.hidden = false;
            if (box.tagName === 'DETAILS') box.open = true;
        }
        container.innerHTML =
            '<ul class="safety-capsize-list">' +
            alerts
                .map((a) => {
                    const hasLoc =
                        a.pos &&
                        typeof a.pos.latitude === 'number' &&
                        typeof a.pos.longitude === 'number';
                    const nameHtml = hasLoc
                        ? `<button type="button" class="device-name--fly device-name--fly-inline" data-fly-lat="${a.pos.latitude}" data-fly-lng="${a.pos.longitude}" data-device-id="${a.deviceId}">${escapeHtml(a.deviceName)}</button>`
                        : `<strong>${escapeHtml(a.deviceName)}</strong>`;
                    return (
                        `<li class="safety-capsize-item">` +
                        `${nameHtml} — ${escapeHtml(a.reason)} ` +
                        `<button type="button" class="safety-capsize-ack" data-capsize-ack="${escapeHtml(a.alertId)}">Acknowledge</button>` +
                        `</li>`
                    );
                })
                .join('') +
            '</ul>';

        container.querySelectorAll('[data-capsize-ack]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-capsize-ack');
                if (id) {
                    acknowledgeCapsizeAlert(id);
                    if (typeof onAck === 'function') onAck();
                }
            });
        });
    }

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    global.AltitudeHdCapsizeAlarm = {
        updateCapsizeAlerts,
        renderCapsizePanel,
        acknowledgeCapsizeAlert,
    };
})(typeof window !== 'undefined' ? window : globalThis);
