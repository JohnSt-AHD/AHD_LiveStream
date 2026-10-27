/**
 * Capsize alarm for rowing safety maps.
 * Detects CrewSight / Traccar capsize alarm attributes only.
 */
(function (global) {
    const LS_ACK = 'altitudeHdCapsizeAck_v1';
    const LS_ACK_NAME = 'crewsight_rowsafe_ack_name';

    /** Same pattern as CrewSight Manager: beep → “Capsize alert” → beep, every 5s until cleared. */
    const ALARM_EVERY_MS = 5000;
    const ALARM_BEEP_MS = 400;
    const ALARM_GAIN = 0.9;
    const ALARM_PHRASE = 'Capsize alert';

    let alarmTimer = null;
    let alarmCtx = null;
    let alarmOscillators = [];
    let alarmSeq = 0;
    let alarmTimeouts = [];
    let audioUnlocked = false;

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

    function readPhase(pos) {
        const attrs = pos?.attributes || {};
        if (
            pos?.capsizePhase === 'responding' ||
            pos?.capsizeResponding === true ||
            attrs.capsizePhase === 'responding' ||
            attrs.capsizeResponding === true
        ) {
            return 'responding';
        }
        return readAlarm(pos) ? 'active' : 'none';
    }

    function readRespondingBy(pos) {
        const attrs = pos?.attributes || {};
        return String(pos?.capsizeRespondingBy || attrs.capsizeRespondingBy || '').trim();
    }

    function onTheWayLine(name) {
        const who = String(name || '').trim();
        return who ? `${who} is on the way` : 'A coach is on the way';
    }

    function storedAckName() {
        try {
            return String(global.localStorage.getItem(LS_ACK_NAME) || '').trim();
        } catch {
            return '';
        }
    }

    function saveAckName(name) {
        const who = String(name || '').trim();
        if (!who) return;
        try {
            global.localStorage.setItem(LS_ACK_NAME, who);
        } catch {
            /* ignore */
        }
    }

    function resolveRowsafeName(kind) {
        const existing = storedAckName();
        if (existing) return existing;
        if (typeof global.prompt !== 'function') {
            return kind === 'safe' ? 'RowSafe' : 'A coach';
        }
        const asked = global.prompt(
            kind === 'safe'
                ? 'Name to show with Crew safe (optional)'
                : 'Your name — shown as on the way',
            '',
        );
        const who = String(asked || '').trim();
        if (who) {
            saveAckName(who);
            return who;
        }
        return kind === 'safe' ? 'RowSafe' : 'A coach';
    }

    function normalizeAckRecord(value) {
        if (value == null) return null;
        if (typeof value === 'object') {
            return {
                at: Number(value.at) || Date.now(),
                kind: value.kind === 'safe' ? 'safe' : 'responding',
                by: String(value.by || '').trim(),
            };
        }
        return { at: Number(value) || Date.now(), kind: 'responding', by: '' };
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

    function unlockAlarmAudio() {
        if (audioUnlocked) return;
        audioUnlocked = true;
        try {
            const Ctx = global.AudioContext || global.webkitAudioContext;
            if (Ctx) {
                const ctx = new Ctx();
                if (ctx.state === 'suspended') void ctx.resume();
                void ctx.close();
            }
            if (typeof global.speechSynthesis !== 'undefined') {
                global.speechSynthesis.getVoices();
            }
        } catch {
            /* ignore */
        }
    }

    function bindAlarmAudioUnlock() {
        const once = { once: true, capture: true };
        global.addEventListener('pointerdown', unlockAlarmAudio, once);
        global.addEventListener('keydown', unlockAlarmAudio, once);
    }

    function clearAlarmTimeouts() {
        for (const id of alarmTimeouts) clearTimeout(id);
        alarmTimeouts = [];
    }

    function stopAlarmSound() {
        clearAlarmTimeouts();
        alarmSeq += 1;
        try {
            if (typeof global.speechSynthesis !== 'undefined') global.speechSynthesis.cancel();
        } catch {
            /* optional */
        }
        try {
            for (const osc of alarmOscillators) {
                try {
                    osc.stop();
                } catch {
                    /* already stopped */
                }
            }
            alarmOscillators = [];
            if (alarmCtx) {
                void alarmCtx.close();
                alarmCtx = null;
            }
        } catch {
            /* optional */
        }
    }

    function playAlarmTone(ctx, seq) {
        if (seq !== alarmSeq) return;
        try {
            if (ctx.state === 'closed') return;
            if (ctx.state === 'suspended') void ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const start = ctx.currentTime;
            const durSec = ALARM_BEEP_MS / 1000;
            osc.type = 'square';
            osc.frequency.setValueAtTime(880, start);
            gain.gain.setValueAtTime(ALARM_GAIN, start);
            gain.gain.setValueAtTime(ALARM_GAIN, start + durSec - 0.04);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + durSec);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + durSec);
            alarmOscillators.push(osc);
            osc.onended = () => {
                alarmOscillators = alarmOscillators.filter((o) => o !== osc);
            };
        } catch {
            /* optional */
        }
    }

    function speakAlarm(seq, onDone) {
        if (seq !== alarmSeq) return;
        if (
            typeof global.speechSynthesis === 'undefined' ||
            typeof global.SpeechSynthesisUtterance === 'undefined'
        ) {
            onDone?.();
            return;
        }
        try {
            const u = new global.SpeechSynthesisUtterance(ALARM_PHRASE);
            u.volume = 1;
            u.rate = 1.05;
            u.pitch = 1.05;
            u.onend = () => {
                if (seq === alarmSeq) onDone?.();
            };
            u.onerror = () => {
                if (seq === alarmSeq) onDone?.();
            };
            global.speechSynthesis.cancel();
            global.speechSynthesis.speak(u);
        } catch {
            onDone?.();
        }
    }

    function playAlarmCycle() {
        stopAlarmSound();
        const seq = alarmSeq;
        try {
            const Ctx = global.AudioContext || global.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            if (ctx.state === 'suspended') void ctx.resume();
            alarmCtx = ctx;
            playAlarmTone(ctx, seq);
            const afterBeep = setTimeout(() => {
                if (seq !== alarmSeq) return;
                speakAlarm(seq, () => {
                    if (seq !== alarmSeq) return;
                    playAlarmTone(ctx, seq);
                });
            }, ALARM_BEEP_MS + 100);
            alarmTimeouts.push(afterBeep);
        } catch {
            /* Browsers may block audio until the user has interacted with the page. */
        }
    }

    function startAlarmLoop() {
        if (alarmTimer != null) return;
        playAlarmCycle();
        alarmTimer = setInterval(playAlarmCycle, ALARM_EVERY_MS);
    }

    function stopAlarmLoop() {
        if (alarmTimer != null) {
            clearInterval(alarmTimer);
            alarmTimer = null;
        }
        stopAlarmSound();
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
            const local = normalizeAckRecord(ack[alertId] || ack[`${d.id}:alarm`]);
            if (local?.kind === 'safe') continue;
            const phase =
                local?.kind === 'responding' || readPhase(pos) === 'responding'
                    ? 'responding'
                    : 'active';
            const respondingBy = readRespondingBy(pos) || local?.by || '';
            active.push({
                alertId,
                deviceId: d.id,
                uniqueId: d.uniqueId || d.name || String(d.id),
                deviceName: d.name || `Device ${d.id}`,
                pos,
                phase,
                respondingBy,
                reason:
                    phase === 'responding'
                        ? onTheWayLine(respondingBy)
                        : `Device alarm: ${traccarAlarm}`,
            });
        }

        if (active.some((a) => a.phase === 'active')) startAlarmLoop();
        else stopAlarmLoop();
        return active;
    }

    async function clearCapsizeAlertUpstream(uniqueId, meta = {}) {
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
                body: JSON.stringify({
                    deviceId: id,
                    ackedBy: meta.ackedBy || 'RowSafe',
                    ackSource: 'rowsafe',
                    ackKind: meta.ackKind || 'responding',
                    ...(meta.ackKind === 'safe' ? { notifyHelp: false } : {}),
                }),
            });
        } catch {
            /* ignore — local ack still updates the panel */
        }
    }

    function isAlertAcknowledged(deviceId, pos) {
        const ack = loadJson(LS_ACK, {});
        const alertId = alertIdFor(deviceId, pos);
        const local = normalizeAckRecord(ack[alertId] || ack[`${deviceId}:alarm`]);
        return Boolean(local);
    }

    function isAlertResponding(deviceId, pos) {
        if (readPhase(pos) === 'responding') return true;
        const ack = loadJson(LS_ACK, {});
        const alertId = alertIdFor(deviceId, pos);
        const local = normalizeAckRecord(ack[alertId] || ack[`${deviceId}:alarm`]);
        return local?.kind === 'responding';
    }

    function writeLocalAck(alertId, kind, by) {
        const ack = loadJson(LS_ACK, {});
        ack[alertId] = { at: Date.now(), kind, by };
        saveJson(LS_ACK, ack);
    }

    function acknowledgeCapsizeAlert(alertId, uniqueId, kind = 'responding') {
        const ackKind = kind === 'safe' ? 'safe' : 'responding';
        const by = resolveRowsafeName(ackKind);
        writeLocalAck(alertId, ackKind, by);
        const log = global.CrewSightCapsizeDayLog;
        if (log && uniqueId) {
            if (ackKind === 'safe' && typeof log.markSafe === 'function') {
                log.markSafe([uniqueId], by, 'rowsafe');
            } else {
                log.acknowledge([uniqueId], by, 'rowsafe');
            }
        }
        void clearCapsizeAlertUpstream(uniqueId, { ackedBy: by, ackKind });
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
                    const responding = a.phase === 'responding';
                    const status = responding
                        ? `<span class="safety-capsize-status">${escapeHtml(onTheWayLine(a.respondingBy))}</span>`
                        : `<span class="safety-capsize-status">${escapeHtml(a.reason)}</span>`;
                    const respondBtn = responding
                        ? ''
                        : `<button type="button" class="safety-capsize-ack" data-capsize-ack="${escapeHtml(a.alertId)}" data-capsize-device="${escapeHtml(a.uniqueId || a.deviceName || '')}" data-capsize-kind="responding">On the way</button>`;
                    const safeBtn = `<button type="button" class="safety-capsize-ack safety-capsize-ack--safe" data-capsize-ack="${escapeHtml(a.alertId)}" data-capsize-device="${escapeHtml(a.uniqueId || a.deviceName || '')}" data-capsize-kind="safe">Crew is safe</button>`;
                    return (
                        `<li class="safety-capsize-item${responding ? ' safety-capsize-item--responding' : ''}">` +
                        `${nameHtml} — ${status} ` +
                        respondBtn +
                        safeBtn +
                        `</li>`
                    );
                })
                .join('') +
            '</ul>';

        container.querySelectorAll('[data-capsize-ack]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-capsize-ack');
                const uniqueId = btn.getAttribute('data-capsize-device');
                const kind = btn.getAttribute('data-capsize-kind') || 'responding';
                if (id) {
                    acknowledgeCapsizeAlert(id, uniqueId, kind);
                    if (typeof onAck === 'function') onAck(uniqueId);
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

    bindAlarmAudioUnlock();

    global.AltitudeHdCapsizeAlarm = {
        readAlarm,
        readPhase,
        isAlertAcknowledged,
        isAlertResponding,
        updateCapsizeAlerts,
        renderCapsizePanel,
        acknowledgeCapsizeAlert,
        onTheWayLine,
    };
})(typeof window !== 'undefined' ? window : globalThis);
