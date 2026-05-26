/**
 * Fixed-size KRI demo fleet icons (rowing shells + safety boat).
 * SVG points north; rotate with course heading (degrees, clockwise from north).
 */
(function (global) {
    const SHELL_W = 14;
    const SHELL_H = 38;
    const SAFETY_W = 24;
    const SAFETY_H = 34;

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Narrow rowing shell — bow at top of viewBox (north). */
    function shellSvg(fill, stroke) {
        const f = escapeHtml(fill);
        const s = escapeHtml(stroke);
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 60" width="${SHELL_W}" height="${SHELL_H}" aria-hidden="true">` +
            `<path d="M14 2 C9 6 7.5 14 7 28 C6.5 42 8 52 14 58 C20 52 21.5 42 21 28 C20.5 14 19 6 14 2 Z" fill="${f}" stroke="${s}" stroke-width="1.6" stroke-linejoin="round"/>` +
            `<ellipse cx="14" cy="30" rx="2.2" ry="10" fill="${f}" stroke="${s}" stroke-width="0.7" opacity="0.45"/>` +
            `</svg>`
        );
    }

    /** Rescue / safety RIB — wider hull, cabin, red cross (top-down). */
    function safetySvg(fill, stroke) {
        const f = escapeHtml(fill);
        const s = escapeHtml(stroke);
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64" width="${SAFETY_W}" height="${SAFETY_H}" aria-hidden="true">` +
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
     * @param {{ kind: 'shell'|'safety', fill: string, stroke: string, heading?: number, capsize?: boolean }} opts
     */
    function createIcon(opts) {
        const kind = opts.kind === 'safety' ? 'safety' : 'shell';
        const fill = opts.fill || '#60a5fa';
        const stroke = opts.stroke || '#1e40af';
        const heading = Number.isFinite(opts.heading) ? opts.heading : 0;
        const capsize = !!opts.capsize;
        const w = kind === 'safety' ? SAFETY_W : SHELL_W;
        const h = kind === 'safety' ? SAFETY_H : SHELL_H;
        const inner = kind === 'safety' ? safetySvg(fill, stroke) : shellSvg(fill, stroke);
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
        SHELL_W,
        SHELL_H,
        SAFETY_W,
        SAFETY_H,
    };
})(typeof window !== 'undefined' ? window : globalThis);
