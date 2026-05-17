/**
 * RowSafe warning email alerts — RowSafe page only.
 */
const HUB_ALERT_LS_SECRET = 'warningAlertSecret_v1';
const HUB_ALERT_LS_LAST_IDS = 'warningAlertLastIds_v1';

let hubAlertConfig = null;

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
    hubAlertConfig = data;
    return data;
}

async function hubAlertPost(action, body = {}) {
    const secret = hubAlertGetSecret();
    if (!secret) {
        throw new Error('Enter and save the alert secret first.');
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

function hubAlertRenderEmailList(emails) {
    const list = document.getElementById('hubWarningEmailList');
    const empty = document.getElementById('hubWarningEmailListEmpty');
    if (!list) return;

    list.innerHTML = '';
    const items = Array.isArray(emails) ? emails : [];

    if (empty) empty.hidden = items.length > 0;

    for (const email of items) {
        const li = document.createElement('li');
        li.className = 'hub-warning-email-item';

        const addr = document.createElement('span');
        addr.className = 'hub-warning-email-address';
        addr.textContent = email;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'hub-warning-email-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.email = email;
        removeBtn.addEventListener('click', () => hubAlertRemoveEmail(email));

        li.appendChild(addr);
        li.appendChild(removeBtn);
        list.appendChild(li);
    }
}

function hubAlertUpdatePreview(cfg) {
    const preview = document.getElementById('hubWarningEmailPreview');
    const messageInput = document.getElementById('hubWarningAlertMessage');
    if (messageInput && cfg?.message != null) {
        messageInput.value = cfg.message;
    }
    if (preview) {
        preview.textContent = cfg?.preview || '';
    }
}

function hubAlertUpdateMeta(cfg) {
    const meta = document.getElementById('hubWarningAlertMeta');
    const note = document.getElementById('hubWarningEmailStorageNote');
    if (!meta) return;

    const parts = [];
    if (cfg.ready) {
        parts.push(`Ready to send · ${cfg.recipients} recipient${cfg.recipients === 1 ? '' : 's'}`);
    } else {
        if (!cfg.resend) parts.push('Set RESEND_API_KEY in Vercel');
        if (!cfg.from) parts.push('Set WARNING_NOTIFY_FROM in Vercel');
        if (!cfg.recipients) parts.push('Add at least one recipient');
        if (!cfg.secret) parts.push('Set WARNING_ALERT_SECRET in Vercel');
    }

    meta.textContent = parts.join(' · ');

    if (note) {
        if (cfg.editable) {
            note.textContent = 'Recipient list is saved in Vercel KV.';
        } else if (cfg.source === 'env') {
            note.textContent =
                'Showing addresses from WARNING_NOTIFY_EMAILS in Vercel. Add Vercel KV to this project to add or remove emails here.';
        } else {
            note.textContent = '';
        }
    }

    const addBtn = document.getElementById('hubWarningAddEmailBtn');
    const saveMsgBtn = document.getElementById('hubWarningSaveMessageBtn');
    const canEdit = Boolean(cfg.editable && hubAlertGetSecret());
    if (addBtn) addBtn.disabled = !canEdit;
    if (saveMsgBtn) saveMsgBtn.disabled = !canEdit;
}

async function hubAlertRefreshPanel() {
    try {
        const cfg = await hubAlertFetchConfig();
        hubAlertRenderEmailList(cfg.emails);
        hubAlertUpdatePreview(cfg);
        hubAlertUpdateMeta(cfg);
    } catch (err) {
        hubAlertSetStatus(err.message || 'Could not load alert settings', true);
    }
}

async function hubAlertAddEmail() {
    const input = document.getElementById('hubWarningNewEmail');
    const email = input?.value.trim() || '';
    if (!email) {
        hubAlertSetStatus('Enter an email address.', true);
        return;
    }
    hubAlertSetStatus('Adding email…');
    try {
        const data = await hubAlertPost('add-email', { email });
        if (input) input.value = '';
        hubAlertRenderEmailList(data.emails);
        await hubAlertRefreshPanel();
        hubAlertSetStatus(`Added ${email}.`);
    } catch (err) {
        hubAlertSetStatus(err.message || 'Could not add email', true);
    }
}

async function hubAlertRemoveEmail(email) {
    hubAlertSetStatus('Removing email…');
    try {
        const data = await hubAlertPost('remove-email', { email });
        hubAlertRenderEmailList(data.emails);
        await hubAlertRefreshPanel();
        hubAlertSetStatus(`Removed ${email}.`);
    } catch (err) {
        hubAlertSetStatus(err.message || 'Could not remove email', true);
    }
}

async function hubAlertSaveMessage() {
    const message = document.getElementById('hubWarningAlertMessage')?.value.trim() || '';
    if (!message) {
        hubAlertSetStatus('Message cannot be empty.', true);
        return;
    }
    hubAlertSetStatus('Saving message…');
    try {
        const data = await hubAlertPost('set-message', { message });
        hubAlertUpdatePreview(data);
        hubAlertSetStatus('Message saved.');
    } catch (err) {
        hubAlertSetStatus(err.message || 'Could not save message', true);
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
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    hubAlertRefreshPanel();
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
        hubAlertUpdateMeta(hubAlertConfig || {});
    });

    document.getElementById('hubWarningAlertSaveSecret')?.addEventListener('click', () => {
        hubAlertSetSecret(secretInput?.value.trim() || '');
        hubAlertSetStatus('Secret saved in this browser.');
        hubAlertRefreshPanel();
    });

    document.getElementById('hubWarningAddEmailBtn')?.addEventListener('click', hubAlertAddEmail);
    document.getElementById('hubWarningNewEmail')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            hubAlertAddEmail();
        }
    });

    document.getElementById('hubWarningSaveMessageBtn')?.addEventListener('click', hubAlertSaveMessage);

    document.getElementById('hubWarningAlertTestBtn')?.addEventListener('click', async () => {
        hubAlertSetStatus('Sending test email…');
        try {
            const data = await hubAlertPost('test', {});
            hubAlertSetStatus(`Test email sent to ${data.sent} recipient(s).`);
        } catch (err) {
            hubAlertSetStatus(err.message || 'Test failed', true);
        }
    });

    panel.addEventListener('toggle', () => {
        if (panel.open) hubAlertRefreshPanel();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('hubWarningAlertsPanel')) return;
    hubAlertWireUi();
});

window.HubWarningAlerts = {
    onSafetyRefresh: hubAlertOnSafetyRefresh,
    refreshConfigUi: hubAlertRefreshPanel,
    openPanel: hubAlertOpenPanel,
};
