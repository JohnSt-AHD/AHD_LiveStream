export const CAMERA_OPTIONS = [
    { id: 'stream', label: 'Stream', hint: 'PGM with graphics and audio' },
    { id: 'start-cam', label: 'Start cam', hint: 'Start pontoon / start tower' },
    { id: 'barge', label: 'Barge', hint: 'Follow / mid-course barge' },
    { id: 'drone', label: 'Drone', hint: 'Aerial' },
    { id: 'podium', label: 'Podium', hint: 'Medal / presentation' },
    { id: 'slow-motion', label: 'Slow motion', hint: 'Hi-speed / replay' },
    { id: 'other', label: 'Other', hint: 'Spare or one-off camera' },
];

export const DEFAULT_CAMERAS = ['stream', 'start-cam', 'barge', 'drone'];

const CAMERA_IDS = new Set(CAMERA_OPTIONS.map((c) => c.id));

export function sanitizeCameras(raw) {
    const ids = (Array.isArray(raw) ? raw : String(raw || '').split(','))
        .map((id) => String(id || '').trim().toLowerCase())
        .filter((id) => CAMERA_IDS.has(id));
    const seen = new Set();
    return ids.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

export function hubRegattaLabel(code) {
    const raw = String(code || '').trim();
    const stripped = raw.replace(/20\d{2}$/i, '').replace(/_?\d{2}$/i, '').replace(/[_-]+$/g, '');
    return (stripped || raw).toUpperCase();
}

export function hubEventSlug(eventType) {
    return String(eventType || '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_');
}

export function hubDateLabel(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
}

function isNamedFinal(round) {
    return /^(?:a\s*)?final\b/i.test(String(round || '').trim());
}

export function hubTitle({ regatta, eventType, raceDate, round, raceNum }) {
    const parts = [
        hubRegattaLabel(regatta),
        hubEventSlug(eventType),
        hubDateLabel(raceDate),
    ].filter(Boolean);
    let title = parts.join(' ');
    if (raceNum && !isNamedFinal(round)) {
        title = `${title} Race ${raceNum}`.trim();
    }
    return title.replace(/\s+/g, ' ').trim();
}

export function hubDescription({ lanes, competitors, results }) {
    const crews = (results?.placings || [])
        .map((p) => String(p.competitor || '').trim())
        .filter(Boolean);
    const laneCrews = (lanes || [])
        .map((l) => String(l.crew || '').trim())
        .filter(Boolean);
    const crewPart = (crews.length ? crews : laneCrews).join(', ');
    const names = (competitors || [])
        .map((n) => String(n || '').trim())
        .filter(Boolean)
        .join(', ');
    if (crewPart && names) return `${crewPart}|${names}`;
    return names || crewPart || '';
}

export function cameraLabel(id) {
    return CAMERA_OPTIONS.find((c) => c.id === id)?.label || id;
}

export function hubFilename(title, cameraId) {
    const cam = cameraLabel(cameraId);
    if (!title) return cam;
    if (cameraId === 'stream') return title;
    return `${title} ${cam}`;
}

export function buildHubClip({
    regatta,
    eventType,
    raceDate,
    round,
    raceNum,
    lanes,
    competitors,
    results,
    cameras,
}) {
    const title = hubTitle({ regatta, eventType, raceDate, round, raceNum });
    const description = hubDescription({ lanes, competitors, results });
    const cams = sanitizeCameras(cameras);
    const list = cams.length ? cams : DEFAULT_CAMERAS;
    return {
        title,
        description,
        files: list.map((camera) => ({
            camera,
            label: cameraLabel(camera),
            filename: hubFilename(title, camera),
        })),
    };
}
