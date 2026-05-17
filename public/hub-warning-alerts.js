/**
 * RowSafe warning email alerts — client notify on new warnings + test UI.
 */
const HUB_ALERT_LS_SECRET = 'warningAlertSecret_v1';
const HUB_ALERT_LS_LAST_IDS = 'warningAlertLastIds_v1';

function hubAlertGetSecret() {
    try {
        return sessionStorage.getItem(HUB_ALERT_LS_SECRET) || '';
    } catch {
        return '';
    }
}

function hubAlertSetSecret(value) {
    try {
        if (value) sessionStorage.setItem(HUB_ALERT_LS_SECRET, value);
        else sessionStorage.removeItem(HUB_ALERT_LS_SECRET);
    } catch {
        /* ignore */
    }
}

function hubAlertLoadLastIds() {
    try {
        const raw = sessionStorage.getItem(HUB_ALERT_LS_LAST_IDS);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
        return [];
    }
}

function hubAlertSaveLastIds(ids) {
    try {
        sessionStorage.setItem(HUB_ALERT_LS_LAST_IDS, JSON.stringify(ids));
    } catch {
        /* ignore */
    }
}

function hubAlertSetStatus(text, isError) {
    const el = document.getElementById('hubWarningAlertStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hub-warning-alert-status--error', Boolean(isError));
}

async function hubAlertFetchConfig() {
    const res = await fetch('/api/warning-alerts?action=status');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Status failed (${res.status})`);
    return data;
}

async function hubAlertPost(action, body = {}) {
    const secret = hubAlertGetSecret();
    if (!secret) {
        throw new Error('Enter the alert secret (same as WARNING_ALERT_SECRET in Vercel).');
    }
    const res = await fetch(`/api/warning-alerts?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Warning-Alert-Secret': secret,
        },
        body: JSON.stringify({ ...body, secret }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

async function hubAlertRefreshConfigUi() {
    const meta = document.getElementById('hubWarningAlertMeta');
    if (!meta) return;
    try {
        const cfg = await hubAlertFetchConfig();
        const parts = [];
        if (cfg.ready) {
            parts.push(`Email ready · ${cfg.recipients} recipient${cfg.recipients === 1 ? '' : 's'}`);
        } else {
            if (!cfg.resend) parts.push('Set RESEND_API_KEY');
            if (!cfg.from) parts.push('Set WARNING_NOTIFY_FROM');
            if (!cfg.recipients) parts.push('Set WARNING_NOTIFY_EMAILS');
            if (!cfg.secret) parts.push('Set WARNING_ALERT_SECRET');
        }
        if (cfg.kv) parts.push('Server cron storage on');
        else parts.push('Browser alerts active (add Vercel KV for 24/7 cron)');
        meta.textContent = parts.join(' · ');
    } catch (err) {
        meta.textContent = err.message || 'Could not load alert config';
    }
}

function hubAlertOnSafetyRefresh(metrics) {
    const toggle = document.getElementById('hubWarningEmailToggle');
    if (!toggle || !toggle.checked) return;
    if (!metrics?.boundaryReady || !Array.isArray(metrics.warningDetails)) return;

    const currentIds = metrics.warningDetails.map((w) => String(w.deviceId)).sort();
    const prevIds = hubAlertLoadLastIds();

    if (prevIds.length === 0) {
        hubAlertSaveLastIds(currentIds);
        return;
    }

    const prevSet = new Set(prevIds);
    const newWarnings = metrics.warningDetails.filter((w) => !prevSet.has(String(w.deviceId)));
    hubAlertSaveLastIds(currentIds);

    if (newWarnings.length === 0) return;

    hubAlertPost('notify', { warnings: newWarnings })
        .then((data) => {
            hubAlertSetStatus(
                `Email sent for ${newWarnings.length} new warning${newWarnings.length === 1 ? '' : 's'} (${data.sent || 0} recipient(s)).`,
            );
        })
        .catch((err) => {
            console.error('Warning email notify:', err);
            hubAlertSetStatus(err.message || 'Email notify failed', true);
        });
}

function hubAlertOpenPanel() {
    const panel = document.getElementById('hubWarningAlertsPanel');
    if (!panel) return;
    panel.open = true;
    panel.classList.add('hub-warning-alerts-panel--highlight');
    window.setTimeout(() => panel.classList.remove('hub-warning-alerts-panel--highlight'), 2200);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    hubAlertRefreshConfigUi();
    const secretInput = document.getElementById('hubWarningAlertSecret');
    secretInput?.focus({ preventScroll: true });
}

function hubAlertWireUi() {
    const panel = document.getElementById('hubWarningAlertsPanel');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';

    const secretInput = document.getElementById('hubWarningAlertSecret');
    const saved = hubAlertGetSecret();
    if (secretInput && saved) secretInput.value = saved;

    secretInput?.addEventListener('change', () => {
        hubAlertSetSecret(secretInput.value.trim());
    });

    document.getElementById('hubWarningAlertSaveSecret')?.addEventListener('click', () => {
        hubAlertSetSecret(secretInput?.value.trim() || '');
        hubAlertSetStatus('Secret saved in this browser only.');
    });

    document.getElementById('hubWarningAlertTestBtn')?.addEventListener('click', async () => {
        hubAlertSetStatus('Sending test email…');
        try {
            const data = await hubAlertPost('test', {});
            hubAlertSetStatus(`Test email sent to ${data.sent} recipient(s).`);
        } catch (err) {
            hubAlertSetStatus(err.message || 'Test failed', true);
        }
    });

    hubAlertRefreshConfigUi();

    document.getElementById('rnzEmailAlertsMenuBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        hubAlertOpenPanel();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('hubWarningAlertsPanel')) return;
    hubAlertWireUi();
});

window.HubWarningAlerts = {
    onSafetyRefresh: hubAlertOnSafetyRefresh,
    refreshConfigUi: hubAlertRefreshConfigUi,
    openPanel: hubAlertOpenPanel,
};
