import {
    archiveDriveId,
    archiveDriveUrl,
    bearerFromRequest,
    getArchiveDriveClient,
    oauthClientId,
    serviceAccountAvailable,
    accessTokenFromAuth,
} from './lib/google-drive.mjs';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS =
    'id,name,mimeType,modifiedTime,size,thumbnailLink,iconLink,webViewLink,webContentLink,parents,driveId,hasThumbnail';
const MAX_PAGE = 100;
const DEFAULT_PAGE = 40;
const SEARCH_REVISION = 'name-only-3';

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function escapeDriveQuery(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sanitizeSearch(raw) {
    return String(raw || '')
        .replace(/['\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function parseSearch(q) {
    const years = [];
    const rest = String(q || '')
        .replace(/\b((?:19|20)\d{2})\b/g, (_, year) => {
            if (!years.includes(year)) years.push(year);
            return ' ';
        })
        .replace(/\s+/g, ' ')
        .trim();
    return { years, rest };
}

function nameClause(word) {
    const e = escapeDriveQuery(word);
    return `name contains '${e}'`;
}

function tokenClause(word) {
    // Drive 400s if orderBy is sent with fullText. Archive files are videos/photos,
    // so filename match is enough; daysheets already map athletes to race labels.
    return nameClause(word);
}

function searchClause(q) {
    const { years, rest } = parseSearch(q);
    const parts = [];
    for (const word of rest.split(/\s+/).filter((w) => w.length >= 2)) {
        parts.push(tokenClause(word));
    }
    for (const year of years) {
        parts.push(nameClause(year));
    }
    return parts.length ? `(${parts.join(' and ')})` : '';
}

function queryUsesFullText(clause) {
    return /\bfullText\b/.test(String(clause || ''));
}

function sanitizeFileId(raw) {
    const id = String(raw || '').trim();
    if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) return '';
    return id;
}

function fileKind(mimeType) {
    const mime = String(mimeType || '').toLowerCase();
    if (mime === FOLDER_MIME) return 'folder';
    if (mime.startsWith('video/') || mime === 'application/vnd.google-apps.video') return 'video';
    if (mime.startsWith('image/') || mime === 'application/vnd.google-apps.photo') return 'image';
    return 'other';
}

function typeClause(type) {
    if (type === 'video') {
        return "(mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.video')";
    }
    if (type === 'image') {
        return "(mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.photo')";
    }
    if (type === 'folder') {
        return `mimeType = '${FOLDER_MIME}'`;
    }
    return '';
}

function mapFile(file) {
    const kind = fileKind(file.mimeType);
    return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        kind,
        modifiedTime: file.modifiedTime || null,
        size: file.size != null ? Number(file.size) : null,
        hasThumbnail: Boolean(file.hasThumbnail && file.thumbnailLink),
        icon: file.iconLink || null,
        webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        previewLink: kind === 'folder'
            ? `https://drive.google.com/drive/folders/${file.id}`
            : `https://drive.google.com/file/d/${file.id}/preview`,
        folderViewLink: kind === 'folder'
            ? `https://drive.google.com/drive/folders/${file.id}`
            : null,
    };
}

function parsePageSize(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_PAGE;
    return Math.min(MAX_PAGE, Math.max(1, Math.round(n)));
}

function driveErrorMessage(e) {
    const api = e?.response?.data?.error;
    const fromApi = api?.message || api?.errors?.[0]?.message;
    const raw = fromApi || (e instanceof Error ? e.message : 'Drive request failed');
    return String(raw).replace(/^Request failed with status code \d+\s*/i, '').slice(0, 240);
}

function listCallOptions({ driveId, q, pageSize, pageToken, orderBy, fields }) {
    const opts = {
        driveId,
        pageSize,
        q,
        fields: fields || `nextPageToken,files(${FILE_FIELDS})`,
    };
    if (pageToken) opts.pageToken = pageToken;
    // Drive 400s if orderBy is present with fullText. Never send it on search.
    if (orderBy && !queryUsesFullText(q)) opts.orderBy = orderBy;
    return opts;
}

async function listDriveFiles(client, params) {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    const qs = {
        corpora: 'drive',
        driveId: params.driveId,
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        pageSize: String(params.pageSize || DEFAULT_PAGE),
        q: params.q,
        fields: params.fields || `nextPageToken,files(${FILE_FIELDS})`,
    };
    if (params.pageToken) qs.pageToken = params.pageToken;
    if (params.orderBy) qs.orderBy = params.orderBy;
    for (const [key, value] of Object.entries(qs)) {
        if (value == null || value === '') continue;
        url.searchParams.set(key, String(value));
    }

    const headers = { Accept: 'application/json' };
    if (client.mode === 'api_key') {
        const key = String(process.env.GOOGLE_DRIVE_API_KEY || '').trim();
        if (key) url.searchParams.set('key', key);
    } else {
        const token = await accessTokenFromAuth(client.auth);
        if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data?.error?.message || `Drive HTTP ${res.status}`);
        err.statusCode = res.status;
        err.response = { status: res.status, data };
        err.driveQ = params.q;
        throw err;
    }
    return { data };
}

function extraSearchQueries(raw) {
    const list = Array.isArray(raw) ? raw : raw != null && raw !== '' ? [raw] : [];
    const out = [];
    const seen = new Set();
    for (const item of list) {
        const q = sanitizeSearch(item);
        if (!q || seen.has(q.toLowerCase())) continue;
        seen.add(q.toLowerCase());
        out.push(q);
        if (out.length >= 3) break;
    }
    return out;
}

async function getFolderMeta(drive, folderId, driveId) {
    if (!folderId || folderId === driveId) {
        try {
            const res = await drive.drives.get({
                driveId,
                fields: 'id,name',
            });
            return {
                id: driveId,
                name: res.data.name || 'AHD Drive',
                parentId: null,
            };
        } catch {
            return { id: driveId, name: 'AHD Drive', parentId: null };
        }
    }

    const res = await drive.files.get({
        fileId: folderId,
        fields: 'id,name,mimeType,parents,driveId',
        supportsAllDrives: true,
    });
    const file = res.data;
    if (file.driveId && file.driveId !== driveId) {
        const err = new Error('Folder is outside the AHD archive Drive.');
        err.statusCode = 403;
        throw err;
    }
    if (file.mimeType !== FOLDER_MIME) {
        const err = new Error('Not a folder.');
        err.statusCode = 400;
        throw err;
    }
    const parentId = Array.isArray(file.parents) && file.parents[0]
        ? file.parents[0]
        : driveId;
    return {
        id: file.id,
        name: file.name || 'Folder',
        parentId,
    };
}

function unconfiguredPayload(driveId, driveUrl, extra = {}) {
    return {
        ok: true,
        configured: false,
        auth: 'none',
        oauthClientId: oauthClientId(),
        driveId,
        driveUrl,
        folderId: driveId,
        folderName: 'AHD Drive',
        parentId: null,
        files: [],
        nextPageToken: null,
        searchRevision: SEARCH_REVISION,
        ...extra,
    };
}

async function sendThumbnail(req, res, driveId) {
    const fileId = sanitizeFileId(req.query.thumb);
    if (!fileId) {
        res.status(400).json({ ok: false, error: 'Invalid file id' });
        return;
    }

    const client = await getArchiveDriveClient(bearerFromRequest(req));
    if (!client) {
        res.status(401).json({ ok: false, error: 'Sign in to load previews.' });
        return;
    }

    const meta = await client.drive.files.get({
        fileId,
        fields: 'id,driveId,mimeType,thumbnailLink,hasThumbnail',
        supportsAllDrives: true,
    });
    if (meta.data.driveId && meta.data.driveId !== driveId) {
        res.status(403).json({ ok: false, error: 'File is outside the AHD archive Drive.' });
        return;
    }

    let thumbUrl = String(meta.data.thumbnailLink || '').trim();
    if (!thumbUrl) {
        res.status(404).end();
        return;
    }
    thumbUrl = thumbUrl.replace(/=s\d+([^\d]|$)/, '=s400$1');

    const token = await accessTokenFromAuth(client.auth);
    const headers = { Accept: 'image/*' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const upstream = await fetch(thumbUrl, {
        headers,
        signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
        res.status(upstream.status === 404 ? 404 : 502).end();
        return;
    }

    const type = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', client.mode === 'user' ? 'private, max-age=300' : 'private, max-age=600');
    res.status(200).send(buffer);
}

export default async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    if (req.method !== 'GET') {
        res.status(405).json({ ok: false, error: 'GET only' });
        return;
    }

    const driveId = archiveDriveId();
    const driveUrl = archiveDriveUrl(driveId);

    if (String(req.query.config || '') === '1') {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
            ok: true,
            oauthClientId: oauthClientId(),
            serviceAccount: await serviceAccountAvailable(),
            driveId,
            driveUrl,
            searchRevision: SEARCH_REVISION,
        });
        return;
    }

    if (req.query.thumb) {
        try {
            await sendThumbnail(req, res, driveId);
        } catch (e) {
            const status = Number(e?.statusCode || e?.response?.status || e?.code) || 502;
            if (!res.headersSent) {
                res.status(status >= 400 && status < 600 ? status : 502).json({
                    ok: false,
                    error: e instanceof Error ? e.message : 'Thumbnail failed',
                });
            }
        }
        return;
    }

    const q = sanitizeSearch(req.query.q);
    const also = extraSearchQueries(req.query.also);
    if (String(req.query.plan || '') === '1') {
        const type = String(req.query.type || 'all').toLowerCase();
        const kind = new Set(['all', 'video', 'image', 'folder']).has(type) ? type : 'all';
        const typeQ = typeClause(kind);
        const clauses = ['trashed = false'];
        const textQ = q ? searchClause(q) : '';
        if (textQ) clauses.push(textQ);
        if (typeQ) clauses.push(typeQ);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
            ok: true,
            searchRevision: SEARCH_REVISION,
            q,
            also,
            driveQ: clauses.join(' and '),
            orderBy: q || also.length ? null : 'folder,name_natural',
            usesFullText: queryUsesFullText(clauses.join(' and ')),
        });
        return;
    }
    const type = String(req.query.type || 'all').toLowerCase();
    const allowedTypes = new Set(['all', 'video', 'image', 'folder']);
    const kind = allowedTypes.has(type) ? type : 'all';
    const folderId = String(req.query.folder || driveId).trim() || driveId;
    const pageToken = String(req.query.pageToken || '').trim() || undefined;
    const pageSize = parsePageSize(req.query.pageSize);

    const client = await getArchiveDriveClient(bearerFromRequest(req));
    if (!client) {
        res.status(200).json(unconfiguredPayload(driveId, driveUrl, {
            q,
            type: kind,
            error: 'Sign in with Google to list archive files.',
        }));
        return;
    }

    try {
        const { drive, mode } = client;
        const folder = q ? null : await getFolderMeta(drive, folderId, driveId);

        const clauses = ['trashed = false'];
        const { years } = parseSearch(q);
        if (q) {
            const textQ = searchClause(q);
            if (textQ) clauses.push(textQ);
        } else {
            clauses.push(`'${escapeDriveQuery(folder.id)}' in parents`);
        }
        const typeQ = typeClause(kind);
        if (typeQ) clauses.push(typeQ);

        const driveQuery = clauses.join(' and ');
        const browsingFolder = !q && !also.length;
        const list = await listDriveFiles(client, listCallOptions({
            driveId,
            q: driveQuery,
            pageSize,
            pageToken,
            orderBy: browsingFolder ? 'folder,name_natural' : undefined,
        }));

        const byId = new Map((list.data.files || []).map((file) => [file.id, file]));

        // Year search should also find videos/photos inside a folder named 2025.
        if (q && years.length && kind !== 'folder' && !pageToken) {
            const folderParts = ['trashed = false', `mimeType = '${FOLDER_MIME}'`];
            folderParts.push(`(${years.map((year) => nameClause(year)).join(' or ')})`);
            const { rest } = parseSearch(q);
            if (rest) {
                for (const word of rest.split(/\s+/).filter((w) => w.length >= 2)) {
                    folderParts.push(tokenClause(word));
                }
            }
            const folders = await listDriveFiles(client, listCallOptions({
                driveId,
                q: folderParts.join(' and '),
                pageSize: 40,
                fields: 'files(id,name)',
            }));
            const folderIds = (folders.data.files || []).map((f) => f.id).filter(Boolean).slice(0, 20);
            if (folderIds.length) {
                const childClauses = [
                    'trashed = false',
                    `(${folderIds.map((id) => `'${escapeDriveQuery(id)}' in parents`).join(' or ')})`,
                ];
                if (typeQ) childClauses.push(typeQ);
                const children = await listDriveFiles(client, listCallOptions({
                    driveId,
                    q: childClauses.join(' and '),
                    pageSize,
                }));
                for (const file of children.data.files || []) {
                    if (file.id) byId.set(file.id, file);
                }
            }
        }

        // Daysheet / competitor hits: also search Drive for race/event labels.
        if (also.length && !pageToken) {
            for (const extra of also) {
                const extraClause = searchClause(extra);
                if (!extraClause) continue;
                const extraParts = ['trashed = false', extraClause];
                if (typeQ) extraParts.push(typeQ);
                const extraQ = extraParts.join(' and ');
                const extraList = await listDriveFiles(client, listCallOptions({
                    driveId,
                    q: extraQ,
                    pageSize,
                }));
                for (const file of extraList.data.files || []) {
                    if (file.id) byId.set(file.id, file);
                }
            }
        }

        const files = [...byId.values()]
            .sort((a, b) => {
                const aFolder = a.mimeType === FOLDER_MIME ? 0 : 1;
                const bFolder = b.mimeType === FOLDER_MIME ? 0 : 1;
                if (aFolder !== bFolder) return aFolder - bFolder;
                return String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || ''));
            })
            .map(mapFile);
        res.setHeader(
            'Cache-Control',
            mode === 'user' ? 'private, no-store' : 'private, max-age=30',
        );
        res.status(200).json({
            ok: true,
            configured: true,
            auth: mode,
            oauthClientId: oauthClientId(),
            driveId,
            driveUrl,
            folderId: folder?.id || driveId,
            folderName: folder?.name || (q ? 'Search' : 'AHD Drive'),
            parentId: folder?.parentId ?? null,
            q,
            also,
            type: kind,
            searchRevision: SEARCH_REVISION,
            driveQ: driveQuery,
            files,
            nextPageToken: list.data.nextPageToken || null,
        });
    } catch (e) {
        const status = Number(e?.statusCode || e?.response?.status || e?.code) || 502;
        const message = driveErrorMessage(e);
        res.status(status >= 400 && status < 600 ? status : 502).json({
            ok: false,
            configured: true,
            auth: 'error',
            oauthClientId: oauthClientId(),
            driveId,
            driveUrl,
            searchRevision: SEARCH_REVISION,
            driveQ: e?.driveQ || null,
            error: message,
        });
    }
}
