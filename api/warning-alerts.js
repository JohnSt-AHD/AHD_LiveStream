import { fetchTraccarSnapshot } from './lib/traccar-login.mjs';
import {
    evaluateSafetySnapshot,
    mergeDevicesFromPositions,
} from './lib/rnz-safety.mjs';
import {
    filterNewWarnings,
    kvAvailable,
    loadLastWarningIds,
    loadStoppedState,
    saveLastWarningIds,
    saveStoppedState,
    warningIdsFromList,
} from './lib/kv-state.mjs';
import { mailConfigStatus, sendWarningEmails } from './lib/mail.mjs';

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Warning-Alert-Secret');
}

function isAuthorized(req) {
    const secret = process.env.WARNING_ALERT_SECRET;
    if (!secret) return false;
    const auth = req.headers.authorization || '';
    if (auth === `Bearer ${secret}`) return true;
    if (auth === `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) return true;
    if (req.headers['x-warning-alert-secret'] === secret) return true;
    if (req.query.secret === secret) return true;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.secret === secret) return true;
    return false;
}

async function readJsonBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    return {};
}

async function buildSnapshotEvaluation() {
    const snapshot = await fetchTraccarSnapshot();
    const positions = {};
    for (const pos of snapshot.positions) {
        if (pos && pos.deviceId != null) positions[pos.deviceId] = pos;
    }
    const devices = mergeDevicesFromPositions(snapshot.devices, positions);
    const stoppedIn = await loadStoppedState();
    const evaluation = evaluateSafetySnapshot(devices, positions, snapshot.geofences, stoppedIn);
    await saveStoppedState(evaluation.stoppedState);
    return evaluation;
}

async function sendNewWarningEmails(warnings, { isTest = false, subjectPrefix = 'RowSafe warning' } = {}) {
    const subject = isTest
        ? `${subjectPrefix} — test`
        : `${subjectPrefix} — ${warnings.length} new (${new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })})`;
    return sendWarningEmails({ subject, warnings, isTest });
}

export default async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const action = req.query.action || 'status';

    try {
        if (action === 'status') {
            const status = mailConfigStatus();
            res.status(200).json({
                ...status,
                kv: await kvAvailable(),
            });
            return;
        }

        if (action === 'test') {
            if (!isAuthorized(req)) {
                res.status(401).json({ error: 'Unauthorized — set X-Warning-Alert-Secret header' });
                return;
            }
            const body = await readJsonBody(req);
            const sample = [
                {
                    deviceId: 0,
                    deviceName: 'Test device',
                    detail: 'Sample warning for email test',
                },
            ];
            const warnings = Array.isArray(body.warnings) && body.warnings.length ? body.warnings : sample;
            const result = await sendNewWarningEmails(warnings, { isTest: true });
            res.status(200).json({ ok: true, ...result });
            return;
        }

        if (action === 'notify') {
            if (!isAuthorized(req)) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            const body = await readJsonBody(req);
            const warnings = Array.isArray(body.warnings) ? body.warnings : [];
            if (warnings.length === 0) {
                res.status(200).json({ ok: true, sent: 0, message: 'No warnings to send' });
                return;
            }
            const result = await sendNewWarningEmails(warnings, { isTest: Boolean(body.isTest) });
            const ids = warningIdsFromList(warnings);
            const prev = await loadLastWarningIds();
            await saveLastWarningIds([...new Set([...prev, ...ids])]);
            res.status(200).json({ ok: true, ...result, count: warnings.length });
            return;
        }

        if (action === 'cron' || action === 'check') {
            if (!isAuthorized(req)) {
                res.status(401).json({ error: 'Unauthorized cron' });
                return;
            }
            const evaluation = await buildSnapshotEvaluation();
            if (!evaluation.boundaryReady) {
                res.status(200).json({ ok: true, skipped: true, reason: 'No RNZ boundary geofence' });
                return;
            }
            const currentIds = warningIdsFromList(evaluation.warnings);
            const previousIds = await loadLastWarningIds();
            const newWarnings = filterNewWarnings(evaluation.warnings, previousIds);
            let emailed = null;
            if (newWarnings.length > 0 && mailConfigStatus().ready) {
                emailed = await sendNewWarningEmails(newWarnings);
            }
            await saveLastWarningIds(currentIds);
            res.status(200).json({
                ok: true,
                total: evaluation.warnings.length,
                newCount: newWarnings.length,
                emailed,
            });
            return;
        }

        res.status(400).json({ error: 'Invalid action. Use status, test, notify, or cron' });
    } catch (error) {
        console.error('warning-alerts:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Warning alerts failed' });
    }
}
