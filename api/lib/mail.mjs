export function parseNotifyEmails() {
    const raw = process.env.WARNING_NOTIFY_EMAILS || '';
    return raw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

export function mailConfigStatus() {
    const emails = parseNotifyEmails();
    return {
        recipients: emails.length,
        resend: Boolean(process.env.RESEND_API_KEY),
        from: Boolean(process.env.WARNING_NOTIFY_FROM),
        secret: Boolean(process.env.WARNING_ALERT_SECRET),
        ready: emails.length > 0 && Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.WARNING_NOTIFY_FROM),
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function buildWarningEmailHtml({ subject, warnings, isTest }) {
    const rows =
        warnings.length > 0
            ? warnings
                  .map(
                      (w) =>
                          `<li><strong>${escapeHtml(w.deviceName)}</strong> — ${escapeHtml(w.detail)} (outside RNZ boundary)</li>`,
                  )
                  .join('')
            : '<li>No active warnings in this test message.</li>';

    const intro = isTest
        ? 'This is a test message from Altitude HD / RowSafe warning alerts.'
        : 'New RowSafe safety warning(s) detected outside the Rowing NZ boundary.';

    return `<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;color:#1e293b">
<p>${escapeHtml(intro)}</p>
<ul>${rows}</ul>
<p style="color:#64748b;font-size:13px">Open the <a href="https://traccar-overlay.vercel.app/rowsafe-map.html">RowSafe map</a> for details.</p>
</body></html>`;
}

export async function sendWarningEmails({ subject, warnings, isTest = false }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.WARNING_NOTIFY_FROM;
    const to = parseNotifyEmails();

    if (!apiKey || !from) {
        throw new Error('RESEND_API_KEY and WARNING_NOTIFY_FROM must be set in Vercel environment variables');
    }
    if (to.length === 0) {
        throw new Error('WARNING_NOTIFY_EMAILS must list at least one recipient');
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
            html: buildWarningEmailHtml({ subject, warnings, isTest }),
        }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || data.error || `Resend failed (${res.status})`);
    }
    return { sent: to.length, id: data.id };
}
