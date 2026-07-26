/**
 * Coach-style speed resolution and RowSafe display tokens (m/s · split · prognostic %).
 */
(function (global) {
    const MIN_MPS = global.RowingSpeed?.MIN_SPEED_MPS ?? 0.25;

    function resolveCoachSpeedMps(pos) {
        if (!pos) return null;
        const attrs = pos.attributes || {};
        const path = attrs.pathSpeedMps ?? pos.pathSpeedMps;
        const display = attrs.displaySpeedMps ?? pos.displaySpeedMps;
        // RowSafe tokens use raw 30s path pace — EMA displaySpeedMps lags on serverless snapshots.
        if (path != null && Number.isFinite(path) && path >= MIN_MPS) return path;
        if (display != null && Number.isFinite(display) && display >= MIN_MPS) return display;
        const spd = pos.speed ?? attrs.speed;
        if (typeof spd === 'number' && Number.isFinite(spd) && spd >= MIN_MPS) return spd;
        return null;
    }

    function formatSpeedToken(speedMps, deviceLabel, athleteId) {
        if (speedMps == null || !Number.isFinite(speedMps) || speedMps < MIN_MPS) return '—';
        const RS = global.RowingSpeed;
        const parts = [`${speedMps.toFixed(2)} m/s`];
        if (RS) {
            const split = RS.formatSplit500m(speedMps);
            if (split !== '—') parts.push(split);
            const labelParts = [];
            if (deviceLabel) labelParts.push(deviceLabel);
            if (athleteId) labelParts.push(athleteId);
            const boat = RS.parseBoatClass(...labelParts);
            const prog = boat ? RS.formatPrognostic(speedMps, boat) : null;
            if (prog) parts.push(prog);
        }
        return parts.join(' · ');
    }

    global.RowsafeCoachSpeed = {
        resolveCoachSpeedMps,
        formatSpeedToken,
    };
})(typeof window !== 'undefined' ? window : globalThis);
