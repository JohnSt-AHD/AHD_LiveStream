/**
 * Google Drive client for the AHD race archive Shared Drive.
 *
 * Auth (first match wins):
 *   Authorization: Bearer <Google user access token>
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT  — JSON key as a string (Vercel)
 *   GOOGLE_DRIVE_CREDENTIALS      — path to a JSON key file
 *   secrets/google-drive-service-account.json
 *   GOOGLE_DRIVE_API_KEY          — public files only
 */
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

/** Altitude HD Shared Drive (root folder id === drive id). */
export const ARCHIVE_DRIVE_ID = '0ALQpKTQVtiMBUk9PVA';

export const ARCHIVE_DRIVE_URL =
    `https://drive.google.com/drive/folders/${ARCHIVE_DRIVE_ID}`;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function credentialsPath() {
    return process.env.GOOGLE_DRIVE_CREDENTIALS
        || join(ROOT, 'secrets', 'google-drive-service-account.json');
}

function parseServiceAccountJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.client_email && parsed?.private_key) return parsed;
    } catch {
        return null;
    }
    return null;
}

async function loadServiceAccount() {
    const fromEnv = parseServiceAccountJson(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT);
    if (fromEnv) return fromEnv;

    const path = credentialsPath();
    try {
        await access(path);
        return parseServiceAccountJson(await readFile(path, 'utf8'));
    } catch {
        return null;
    }
}

export function archiveDriveId() {
    return String(process.env.GOOGLE_DRIVE_ARCHIVE_DRIVE_ID || ARCHIVE_DRIVE_ID).trim()
        || ARCHIVE_DRIVE_ID;
}

export function archiveDriveUrl(driveId = archiveDriveId()) {
    return `https://drive.google.com/drive/folders/${driveId}`;
}

export function oauthClientId() {
    return String(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || '').trim();
}

export async function serviceAccountAvailable() {
    if (parseServiceAccountJson(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT)) return true;
    if (String(process.env.GOOGLE_DRIVE_API_KEY || '').trim()) return true;
    try {
        await access(credentialsPath());
        return true;
    } catch {
        return false;
    }
}

function isUserAccessToken(raw) {
    const token = String(raw || '').trim();
    if (token.length < 20 || token.length > 8192) return false;
    if (/\s/.test(token) || token.startsWith('{')) return false;
    return true;
}

export function bearerFromRequest(req) {
    const header = String(req?.headers?.authorization || '');
    const match = header.match(/^Bearer\s+(\S+)/i);
    return match ? match[1] : '';
}

/**
 * @returns {Promise<{ drive: object, auth: object, mode: 'user' | 'service_account' | 'api_key' } | null>}
 */
export async function getArchiveDriveClient(accessToken) {
    if (isUserAccessToken(accessToken)) {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: String(accessToken).trim() });
        return {
            drive: google.drive({ version: 'v3', auth }),
            auth,
            mode: 'user',
        };
    }

    const credentials = await loadServiceAccount();
    if (credentials) {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [DRIVE_SCOPE],
        });
        return {
            drive: google.drive({ version: 'v3', auth }),
            auth,
            mode: 'service_account',
        };
    }

    const apiKey = String(process.env.GOOGLE_DRIVE_API_KEY || '').trim();
    if (apiKey) {
        return {
            drive: google.drive({ version: 'v3', auth: apiKey }),
            auth: null,
            mode: 'api_key',
        };
    }

    return null;
}

export async function accessTokenFromAuth(auth) {
    if (!auth || typeof auth.getAccessToken !== 'function') return '';
    try {
        const result = await auth.getAccessToken();
        if (typeof result === 'string') return result;
        return String(result?.token || result?.access_token || '').trim();
    } catch {
        return '';
    }
}
