/**
 * KRI demo fleet icons (rowing shells + safety boat).
 * Max size at REF_ZOOM; scales down when zoomed out to reduce overlap.
 */
(function (global) {
    const SHELL_W = 7;
    const SHELL_H = 19;
    const SAFETY_W = 12;
    const SAFETY_H = 17;
    const REF_ZOOM = 14;
    const MIN_BOAT_SCALE = 0.4;
    const MIN_LABEL_SCALE = 0.45;
    const LABEL_SIZE_FACTOR = 0.5;
    const LABEL_HIDE_BELOW_ZOOM = 11;

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function clampScale(raw, minScale) {
        return Math.min(1, Math.max(minScale, raw));
    }

    /** Scale 1 at REF_ZOOM; shrinks when zoomed out (max size cap). */
    function getZoomScale(zoom) {
        if (!Number.isFinite(zoom)) return 1;
        return clampScale(Math.pow(2, zoom - REF_ZOOM), MIN_BOAT_SCALE);
    }

    /** Course labels — hidden below LABEL_HIDE_BELOW_ZOOM. */
    function getLabelZoomScale(zoom) {
        if (!Number.isFinite(zoom)) return 1;
        if (zoom < LABEL_HIDE_BELOW_ZOOM) return 0;
        return clampScale(Math.pow(2, zoom - REF_ZOOM), MIN_LABEL_SCALE) * LABEL_SIZE_FACTOR;
    }

    /** Narrow rowing shell — bow at top of viewBox (north). */
    function shellSvg(fill, stroke, w, h) {
        const f = escapeHtml(fill);
        const s = escapeHtml(stroke);
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 60" width="${w}" height="${h}" aria-hidden="true">` +
            `<path d="M14 2 C9 6 7.5 14 7 28 C6.5 42 8 52 14 58 C20 52 21.5 42 21 28 C20.5 14 19 6 14 2 Z" fill="${f}" stroke="${s}" stroke-width="1.6" stroke-linejoin="round"/>` +
            `<ellipse cx="14" cy="30" rx="2.2" ry="10" fill="${f}" stroke="${s}" stroke-width="0.7" opacity="0.45"/>` +
            `</svg>`
        );
    }

    /** Rescue / safety RIB — wider hull, cabin, red cross (top-down). */
    function safetySvg(fill, stroke, w, h) {
        const f = escapeHtml(fill);
        const s = escapeHtml(stroke);
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64" width="${w}" height="${h}" aria-hidden="true">` +
            `<path d="M24 3 L42 58 Q24 63 6 58 Z" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>` +
            `<path d="M24 8 L36 54 Q24 58 12 54 Z" fill="rgba(255,255,255,0.22)" stroke="none"/>` +
            `<rect x="15" y="24" width="18" height="16" rx="2.5" fill="#f8fafc" stroke="${s}" stroke-width="1.2"/>` +
            `<rect x="22" y="28" width="4" height="8" fill="#dc2626"/>` +
            `<rect x="19" y="31" width="10" height="4" fill="#dc2626"/>` +
            `<circle cx="24" cy="52" r="2.5" fill="#0f172a" opacity="0.35"/>` +
            `</svg>`
        );
    }

    /**
     * @param {{ kind: 'shell'|'safety', fill: string, stroke: string, heading?: number, capsize?: boolean, scale?: number }} opts
     */
    function createIcon(opts) {
        const kind = opts.kind === 'safety' ? 'safety' : 'shell';
        const fill = opts.fill || '#60a5fa';
        const stroke = opts.stroke || '#1e40af';
        const heading = Number.isFinite(opts.heading) ? opts.heading : 0;
        const capsize = !!opts.capsize;
        const scale =
            opts.scale != null && Number.isFinite(opts.scale)
                ? clampScale(opts.scale, MIN_BOAT_SCALE)
                : 1;
        const baseW = kind === 'safety' ? SAFETY_W : SHELL_W;
        const baseH = kind === 'safety' ? SAFETY_H : SHELL_H;
        const w = Math.max(2, Math.round(baseW * scale));
        const h = Math.max(5, Math.round(baseH * scale));
        const inner = kind === 'safety' ? safetySvg(fill, stroke, w, h) : shellSvg(fill, stroke, w, h);
        const capsizeClass = capsize ? ' rnz-marker-capsize' : '';
        const html =
            `<div class="kri-boat-marker${capsizeClass}" style="--kri-heading:${heading}deg">` +
            `<div class="kri-boat-marker__rotate">${inner}</div>` +
            `</div>`;

        if (typeof global.L === 'undefined') return null;
        return global.L.divIcon({
            className: `kri-boat-icon kri-boat-icon--${kind}`,
            html,
            iconSize: [w, h],
            iconAnchor: [w / 2, h / 2],
        });
    }

    function isDemoBoatDevice(device) {
        return device?.demoMarkerKind === 'shell' || device?.demoMarkerKind === 'safety';
    }

    global.KriSafetyMarkers = {
        createIcon,
        isDemoBoatDevice,
        getZoomScale,
        getLabelZoomScale,
        REF_ZOOM,
        MIN_BOAT_SCALE,
        MIN_LABEL_SCALE,
        LABEL_SIZE_FACTOR,
        LABEL_HIDE_BELOW_ZOOM,
        SHELL_W,
        SHELL_H,
        SAFETY_W,
        SAFETY_H,
    };
})(typeof window !== 'undefined' ? window : globalThis);
