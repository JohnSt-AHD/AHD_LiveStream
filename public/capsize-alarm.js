/**
 * Capsize alarm for rowing safety maps.
 * Detects CrewSight / Traccar capsize alarm attributes only.
 */
(function (global) {
    const LS_ACK = 'altitudeHdCapsizeAck_v1';

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

    function readAlarm(pos) {
        if (pos?.capsize === true) return 'capsize';
        const attrs = pos?.attributes;
        if (!attrs || typeof attrs !== 'object') return null;
        if (attrs.capsize === true) return 'capsize';
        const raw = attrs.alarm || attrs.Alarm || attrs.event || attrs.sos;
        if (typeof raw !== 'string') return null;
        if (/capsize|cap.?size|flip|overturn|sos|panic|distress|emergency/i.test(raw)) {
            return raw;
        }
        return null;
    }

    function alertIdFor(deviceId, pos) {
        const at = Number(pos?.attributes?.capsizeAlertAt);
        if (Number.isFinite(at) && at > 0) return `${deviceId}:alarm:${at}`;
        return `${deviceId}:alarm`;
    }

    /** Drop local acks once the upstream alarm is gone so a later tip can re-alert. */
    function pruneAcksForClearedAlarms(ack, devices, positions) {
        let dirty = false;
        for (const key of Object.keys(ack)) {
            const deviceId = key.split(':')[0];
            const pos = positions[deviceId] ?? positions[Number(deviceId)];
            if (!pos || !readAlarm(pos)) {
                delete ack[key];
                dirty = true;
            }
        }
        // Also drop legacy device-wide acks when a newer event id is live.
        for (const d of devices || []) {
            const pos = positions[d.id];
            if (!pos || !readAlarm(pos)) continue;
            const eventId = alertIdFor(d.id, pos);
            const legacy = `${d.id}:alarm`;
            if (eventId !== legacy && ack[legacy]) {
                delete ack[legacy];
                dirty = true;
            }
        }
        return dirty;
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
        const ack = loadJson(LS_ACK, {});
        if (pruneAcksForClearedAlarms(ack, devices, positions)) {
            saveJson(LS_ACK, ack);
        }
        const active = [];

        for (const d of devices || []) {
            const pos = positions[d.id];
            if (!pos) continue;

            const traccarAlarm = readAlarm(pos);
            if (!traccarAlarm) continue;

            const alertId = alertIdFor(d.id, pos);
            if (ack[alertId] || ack[`${d.id}:alarm`]) continue;
            active.push({
                alertId,
                deviceId: d.id,
                uniqueId: d.uniqueId || d.name || String(d.id),
                deviceName: d.name || `Device ${d.id}`,
                pos,
                reason: `Device alarm: ${traccarAlarm}`,
            });
        }

        if (active.length) playAlarmTone();
        return active;
    }

    async function clearCapsizeAlertUpstream(uniqueId) {
        const id = String(uniqueId || '').trim();
        if (!id) return;
        try {
            const ts = global.AltitudeHdTrackerSource;
            const url = ts?.buildTraccarUrl
                ? ts.buildTraccarUrl({ action: 'capsize-clear' })
                : '/api/traccar?action=capsize-clear&source=rowing';
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: id }),
            });
        } catch {
            /* ignore — local ack still hides the banner */
        }
    }

    function acknowledgeCapsizeAlert(alertId, uniqueId) {
        const ack = loadJson(LS_ACK, {});
        ack[alertId] = Date.now();
        saveJson(LS_ACK, ack);
        void clearCapsizeAlertUpstream(uniqueId);
    }

    function renderCapsizePanel(container, alerts, onAck, options = {}) {
        if (!container) return;
        const box = document.getElementById('safetyCapsizeBox');
        const alwaysVisible = Boolean(options.alwaysVisible);
        if (!alerts.length) {
            if (box) {
                box.hidden = !alwaysVisible;
                if (alwaysVisible && box.tagName === 'DETAILS') box.open = true;
            }
            container.innerHTML = alwaysVisible
                ? '<p class="rnz-list-empty">No active capsize alarms.</p>'
                : '';
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
                        `<button type="button" class="safety-capsize-ack" data-capsize-ack="${escapeHtml(a.alertId)}" data-capsize-device="${escapeHtml(a.uniqueId || a.deviceName || '')}">Acknowledge</button>` +
                        `</li>`
                    );
                })
                .join('') +
            '</ul>';

        container.querySelectorAll('[data-capsize-ack]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-capsize-ack');
                const uniqueId = btn.getAttribute('data-capsize-device');
                if (id) {
                    acknowledgeCapsizeAlert(id, uniqueId);
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
