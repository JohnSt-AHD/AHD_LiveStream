/**
 * Export downsampled H6 / Traccar tracks for documents map overlay.
 * Usage: node scripts/export-h6-traccar-tracks.mjs
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'data', 'documents-h6-traccar-2026-06-04.json');

const FROM = '2026-06-03T23:30:00.000Z';
const TO = '2026-06-04T00:15:00.000Z';
const RECORDER = 'https://rowing-app-recorder-pwa.vercel.app';
const OVERLAY = 'https://ahd-livestream.vercel.app';
const TRACCAR_DEVICE = 36;
const MAX_POINTS = 450;

function downsample(points, max) {
    if (points.length <= max) return points;
    const step = points.length / max;
    const out = [];
    for (let i = 0; i < max; i++) {
        out.push(points[Math.min(points.length - 1, Math.floor(i * step))]);
    }
    return out;
}

function toLatLngs(pts) {
    return pts.map((p) => [p.latitude, p.longitude]);
}

async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
}

async function main() {
    const [recorder, traccar] = await Promise.all([
        fetchJson(`${RECORDER}/api/history?uniqueId=H6&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`),
        fetchJson(
            `${OVERLAY}/api/traccar?action=route&deviceId=${TRACCAR_DEVICE}&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
        ),
    ]);

    const sortByTime = (a, b) => new Date(a.fixTime) - new Date(b.fixTime);
    recorder.sort(sortByTime);
    traccar.sort(sortByTime);

    const payload = {
        session: {
            from: FROM,
            to: TO,
            label: '4 Jun 2026 · 11:30–12:15 NZST',
            recorderDevice: 'H6',
            traccarDevice: 'John Start (id 36)',
        },
        pins: {
            start: { name: 'Start pin', lat: -37.943356, lng: 175.556788 },
            finish: { name: 'Finish pin', lat: -37.929223, lng: 175.542716 },
        },
        tracks: {
            recorder: {
                label: 'Recorder (H6)',
                color: '#00e5ff',
                count: recorder.length,
                points: toLatLngs(downsample(recorder, MAX_POINTS)),
            },
            traccar: {
                label: 'Traccar (John Start)',
                color: '#f59e0b',
                count: traccar.length,
                points: toLatLngs(downsample(traccar, MAX_POINTS)),
            },
        },
    };

    writeFileSync(OUT, JSON.stringify(payload));
    console.log('Wrote', OUT);
    console.log('Recorder', recorder.length, '→', payload.tracks.recorder.points.length);
    console.log('Traccar', traccar.length, '→', payload.tracks.traccar.points.length);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
