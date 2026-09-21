/**
 * Local AHD LiveStream: static public/ + Vercel-style /api/*.js handlers.
 * vMix Browser: http://127.0.0.1:8787/vmix-kri.html?g=x
 */
import http from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import {
    queueRefreshWatched,
    seedWatchedFromEnv,
    watchedCodes,
    isLiveCsvPollDay,
} from './api/lib/rowit-cache.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC_DIR = join(ROOT, 'public');
const API_DIR = join(ROOT, 'api');
const PORT = Number(process.env.PORT || 8787);
const HOST = String(process.env.HOST || '0.0.0.0');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.csv': 'text/csv; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.map': 'application/json',
};

function loadEnvFile(filePath) {
    if (!existsSync(filePath)) return;
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

loadEnvFile(join(ROOT, '.env'));
loadEnvFile(join(ROOT, '.env.local'));

function lanIps() {
    const ips = [];
    for (const entries of Object.values(networkInterfaces())) {
        for (const net of entries || []) {
            if (net.family !== 'IPv4' || net.internal) continue;
            ips.push(net.address);
        }
    }
    return ips;
}

function queryFromUrl(url) {
    const query = {};
    for (const [key, value] of url.searchParams.entries()) {
        if (query[key] === undefined) query[key] = value;
        else if (Array.isArray(query[key])) query[key].push(value);
        else query[key] = [query[key], value];
    }
    return query;
}

async function readBody(req) {
    const chunks = [];
    let total = 0;
    const max = 2 * 1024 * 1024;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > max) throw new Error('Request body too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function wrapRes(nodeRes) {
    let statusCode = 200;
    const wrapped = {
        get headersSent() {
            return nodeRes.headersSent;
        },
        setHeader(name, value) {
            if (!nodeRes.headersSent) nodeRes.setHeader(name, value);
            return wrapped;
        },
        getHeader(name) {
            return nodeRes.getHeader(name);
        },
        status(code) {
            statusCode = Number(code) || 200;
            return wrapped;
        },
        json(body) {
            if (nodeRes.headersSent) return wrapped;
            nodeRes.statusCode = statusCode;
            nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
            nodeRes.end(JSON.stringify(body));
            return wrapped;
        },
        send(body) {
            if (nodeRes.headersSent) return wrapped;
            nodeRes.statusCode = statusCode;
            if (body == null) {
                nodeRes.end();
                return wrapped;
            }
            if (typeof body === 'object' && !Buffer.isBuffer(body)) {
                nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                nodeRes.end(JSON.stringify(body));
                return wrapped;
            }
            nodeRes.end(body);
            return wrapped;
        },
        end(body) {
            if (nodeRes.headersSent) return wrapped;
            nodeRes.statusCode = statusCode;
            nodeRes.end(body);
            return wrapped;
        },
    };
    return wrapped;
}

function safePublicPath(urlPath) {
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    const rel = decoded.replace(/^\/+/, '');
    const abs = resolve(PUBLIC_DIR, rel);
    const relToPublic = relative(PUBLIC_DIR, abs);
    if (relToPublic.startsWith('..') || relToPublic.startsWith(`..${sep}`)) return null;
    return abs;
}

function sendFile(nodeRes, filePath, req) {
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const stat = statSync(filePath);
    nodeRes.setHeader('Content-Type', type);
    nodeRes.setHeader('Accept-Ranges', 'bytes');
    if (type.startsWith('text/html') || type.startsWith('text/javascript') || type.startsWith('text/css')) {
        nodeRes.setHeader('Cache-Control', 'no-store');
    } else {
        nodeRes.setHeader('Cache-Control', 'public, max-age=120');
    }
    const range = String(req?.headers?.range || '');
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m && (type.startsWith('video/') || type.startsWith('audio/'))) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
            nodeRes.statusCode = 416;
            nodeRes.setHeader('Content-Range', `bytes */${stat.size}`);
            nodeRes.end();
            return;
        }
        nodeRes.statusCode = 206;
        nodeRes.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        nodeRes.setHeader('Content-Length', String(end - start + 1));
        createReadStream(filePath, { start, end }).pipe(nodeRes);
        return;
    }
    nodeRes.setHeader('Content-Length', String(stat.size));
    createReadStream(filePath).pipe(nodeRes);
}

const handlerCache = new Map();

async function loadApiHandler(name) {
    if (handlerCache.has(name)) return handlerCache.get(name);
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
    const filePath = join(API_DIR, `${name}.js`);
    if (!existsSync(filePath)) return null;
    const mod = await import(pathToFileURL(filePath).href);
    const handler = mod.default;
    if (typeof handler !== 'function') return null;
    handlerCache.set(name, handler);
    return handler;
}

async function handleApi(req, nodeRes, url) {
    const parts = url.pathname.split('/').filter(Boolean);
    const telemetryAll =
        parts[0] === 'api' && parts[1] === 'drone-telemetry' && parts[2] === 'all' && parts.length === 3;
    if (parts[0] !== 'api' || (parts.length !== 2 && !telemetryAll)) {
        nodeRes.statusCode = 404;
        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
        nodeRes.end(JSON.stringify({ error: 'API route not found' }));
        return;
    }

    const handler = await loadApiHandler(parts[1]);
    if (!handler) {
        nodeRes.statusCode = 404;
        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
        nodeRes.end(JSON.stringify({ error: `No handler for /api/${parts[1]}` }));
        return;
    }

    const vercelReq = req;
    vercelReq.query = queryFromUrl(url);
    if (telemetryAll) vercelReq.query.all = '1';
    vercelReq.url = url.pathname + url.search;

    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        const raw = await readBody(req);
        const text = raw.toString('utf8');
        const ctype = String(req.headers['content-type'] || '');
        if (text && ctype.includes('application/json')) {
            try {
                vercelReq.body = JSON.parse(text);
            } catch {
                vercelReq.body = text;
            }
        } else if (text && ctype.includes('application/x-www-form-urlencoded')) {
            vercelReq.body = Object.fromEntries(new URLSearchParams(text));
        } else {
            vercelReq.body = text || {};
        }
    } else {
        vercelReq.body = {};
    }

    await handler(vercelReq, wrapRes(nodeRes));
}

function handleStatic(nodeRes, url, req) {
    let rel = url.pathname === '/' ? 'index.html' : url.pathname;
    let filePath = safePublicPath(rel);
    if (!filePath) {
        nodeRes.statusCode = 400;
        nodeRes.end('Bad path');
        return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, 'index.html');
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        nodeRes.statusCode = 404;
        nodeRes.setHeader('Content-Type', 'text/plain; charset=utf-8');
        nodeRes.end('Not found');
        return;
    }
    sendFile(nodeRes, filePath, req);
}

const server = http.createServer(async (req, nodeRes) => {
    try {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        if (url.pathname === '/health') {
            nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
            nodeRes.end(
                JSON.stringify({
                    ok: true,
                    local: true,
                    port: PORT,
                    lan: lanIps(),
                    rowitCodes: watchedCodes(),
                }),
            );
            return;
        }
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
            await handleApi(req, nodeRes, url);
            return;
        }
        handleStatic(nodeRes, url, req);
    } catch (err) {
        console.error('[local]', err);
        if (!nodeRes.headersSent) {
            nodeRes.statusCode = 500;
            nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
            nodeRes.end(
                JSON.stringify({
                    error: err instanceof Error ? err.message : 'Server error',
                }),
            );
        }
    }
});

server.listen(PORT, HOST, () => {
    const ips = lanIps();
    const local = `http://127.0.0.1:${PORT}`;
    console.log('AHD LiveStream local overlays');
    console.log(`  ${local}`);
    for (const ip of ips) console.log(`  http://${ip}:${PORT}`);
    console.log('');
    console.log('vMix Browser (1920×1080, transparent):');
    console.log(`  ${local}/vmix-kri.html?g=x`);
    console.log(`  ${local}/local.html`);
    console.log('');
    console.log('CV Python: set CV_API_URL to');
    console.log(`  ${local}/api/cv-position`);
    seedWatchedFromEnv();
    const codes = watchedCodes();
    if (codes.length) {
        const liveNow = codes.filter((c) => isLiveCsvPollDay(c));
        console.log(
            `RowIT local cache: watching ${codes.join(', ')}` +
                (liveNow.length
                    ? ' (1-min poll today)'
                    : ' (1-min poll on race days only)'),
        );
        queueRefreshWatched();
    } else {
        console.log(
            'RowIT local cache: will watch the first regatta code requested (1-min poll on race days).',
        );
    }
    setInterval(() => queueRefreshWatched(), 60_000);
    console.log('Ctrl+C to stop.');
});
