/**
 * Stable per-device colours for RowSafe map markers, on-water cards, and pace chart.
 */
(function (global) {
    const PALETTE = [
        { fill: '#38bdf8', stroke: '#0284c7' },
        { fill: '#a78bfa', stroke: '#7c3aed' },
        { fill: '#4ade80', stroke: '#16a34a' },
        { fill: '#fb923c', stroke: '#ea580c' },
        { fill: '#f472b6', stroke: '#db2777' },
        { fill: '#facc15', stroke: '#ca8a04' },
        { fill: '#2dd4bf', stroke: '#0d9488' },
        { fill: '#818cf8', stroke: '#4f46e5' },
    ];

    /** @type {Map<string, { fill: string, stroke: string }>} */
    const registry = new Map();

    function normalizeId(deviceId) {
        return deviceId == null ? '' : String(deviceId);
    }

    function compareDeviceIds(a, b) {
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    }

    function sync(deviceIds) {
        const ids = [...new Set((deviceIds || []).map(normalizeId).filter(Boolean))].sort(compareDeviceIds);
        const next = new Map();
        ids.forEach((id, index) => {
            next.set(id, PALETTE[index % PALETTE.length]);
        });
        registry.clear();
        for (const [id, color] of next) registry.set(id, color);
        return registry;
    }

    function get(deviceId) {
        const id = normalizeId(deviceId);
        if (!id) return PALETTE[0];
        return registry.get(id) || PALETTE[Math.abs(hashId(id)) % PALETTE.length];
    }

    function hashId(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
        return h;
    }

    function fill(deviceId) {
        return get(deviceId).fill;
    }

    function stroke(deviceId) {
        return get(deviceId).stroke;
    }

    global.RnzDeviceColors = {
        PALETTE,
        sync,
        get,
        fill,
        stroke,
    };
})(typeof window !== 'undefined' ? window : globalThis);
