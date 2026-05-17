import {
    loadAlertMessage,
    loadNotifyEmailList,
    saveAlertMessage,
    saveNotifyEmailList,
} from './kv-state.mjs';

export const DEFAULT_ALERT_MESSAGE =
    'New RowSafe safety warning(s) detected outside the Rowing NZ boundary.';

export async function getNotifyEmailsForSend() {
    const { emails } = await loadNotifyEmailList();
    return emails;
}

export async function mailConfigStatus() {
    const { emails, editable, source } = await loadNotifyEmailList();
    const message = await loadAlertMessage();
    return {
        recipients: emails.length,
        emails,
        message,
        editable,
        source,
        resend: Boolean(process.env.RESEND_API_KEY),
        from: Boolean(process.env.WARNING_NOTIFY_FROM),
        secret: Boolean(process.env.WARNING_ALERT_SECRET),
        ready:
            emails.length > 0 &&
            Boolean(process.env.RESEND_API_KEY) &&
            Boolean(process.env.WARNING_NOTIFY_FROM),
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function buildWarningEmailHtml({ subject, warnings, isTest, intro }) {
    const rows =
        warnings.length > 0
            ? warnings
                  .map(
                      (w) =>
                          `<li><strong>${escapeHtml(w.deviceName)}</strong> — ${escapeHtml(w.detail)} (outside RNZ boundary)</li>`,
                  )
                  .join('')
            : '<li>No active warnings in this test message.</li>';

    const bodyIntro = isTest
        ? 'This is a test message from Altitude HD / RowSafe warning alerts.'
        : intro || DEFAULT_ALERT_MESSAGE;

    return `<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;color:#1e293b">
<p>${escapeHtml(bodyIntro)}</p>
<ul>${rows}</ul>
<p style="color:#64748b;font-size:13px">Open the <a href="https://traccar-overlay.vercel.app/rowsafe-map.html">RowSafe map</a> for details.</p>
</body></html>`;
}

export function buildWarningEmailPreviewText({ warnings, isTest, intro }) {
    const bodyIntro = isTest
        ? 'This is a test message from Altitude HD / RowSafe warning alerts.'
        : intro || DEFAULT_ALERT_MESSAGE;
    const lines =
        warnings.length > 0
            ? warnings.map((w) => `• ${w.deviceName} — ${w.detail} (outside RNZ boundary)`)
            : ['• No active warnings in this test message.'];
    return `${bodyIntro}\n\n${lines.join('\n')}\n\nOpen the RowSafe map for details.`;
}

export async function sendWarningEmails({ subject, warnings, isTest = false }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.WARNING_NOTIFY_FROM;
    const to = await getNotifyEmailsForSend();
    const intro = await loadAlertMessage();

    if (!apiKey || !from) {
        throw new Error('RESEND_API_KEY and WARNING_NOTIFY_FROM must be set in Vercel environment variables');
    }
    if (to.length === 0) {
        throw new Error('Add at least one recipient email on the RowSafe email alerts page');
    }

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to,
            subject,
            html: buildWarningEmailHtml({ subject, warnings, isTest, intro }),
        }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || data.error || `Resend failed (${res.status})`);
    }
    return { sent: to.length, id: data.id, to };
}

export async function addNotifyEmail(email) {
    const { emails, editable } = await loadNotifyEmailList();
    if (!editable) {
        throw new Error('Vercel KV is required to add recipients in the browser.');
    }
    const next = [...emails, email];
    return saveNotifyEmailList(next);
}

export async function removeNotifyEmail(email) {
    const { emails, editable } = await loadNotifyEmailList();
    if (!editable) {
        throw new Error('Vercel KV is required to remove recipients in the browser.');
    }
    const target = String(email || '').trim().toLowerCase();
    return saveNotifyEmailList(emails.filter((e) => e !== target));
}

export { saveAlertMessage };
