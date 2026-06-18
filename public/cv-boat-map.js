/**
 * Map CV stable slots to daysheet draw lanes for the active live race.
 * CV sends geometry (slot, x, y, laneCoord); overlay resolves crew/logo from draw.
 */
(function (global) {
    function normalizeDirection(value) {
        const raw = String(value || 'left_to_right').toLowerCase().replace(/-/g, '_');
        if (raw === 'overhead' || raw === 'right_to_left' || raw === 'left_to_right') return raw;
        if (raw === 'twizel') return 'right_to_left';
        if (raw === 'karapiro') return 'left_to_right';
        return 'left_to_right';
    }

    /** Lanes in screen order (slot 1 first) for the given boat direction. */
    function lanesInScreenOrder(race, boatDirection) {
        const lanes = (race?.lanes || [])
            .filter((entry) => entry && entry.code)
            .sort((a, b) => a.lane - b.lane);
        const dir = normalizeDirection(boatDirection);
        if (dir === 'overhead') {
            return [...lanes].reverse();
        }
        return lanes;
    }

    function parseClubCode(code) {
        const raw = String(code || '').trim();
        const m = raw.match(/^([a-z0-9]+)(?:\s*[-.]?\s*(\d+))?$/i);
        if (!m) return { id: raw.toLowerCase(), crewNum: '' };
        return { id: m[1].toLowerCase(), crewNum: m[2] || '' };
    }

    function clubInfo(clubId, lookup) {
        const id = String(clubId || '').toLowerCase();
        if (!id || !lookup?.clubs) {
            return { name: String(clubId || '').toUpperCase(), logoUrl: null };
        }
        const club = lookup.clubs[id];
        if (!club) return { name: id.toUpperCase(), logoUrl: null };
        return {
            name: club.name || id.toUpperCase(),
            logoUrl: club.logo
                ? `assets/school-logos/${encodeURIComponent(club.logo)}`
                : null,
        };
    }

    function enrichLaneEntry(entry, lookup) {
        const club = parseClubCode(entry.code);
        const info = clubInfo(club.id, lookup);
        return {
            lane: entry.lane,
            code: entry.code,
            label: info.name,
            shortLabel: club.id ? club.id.toUpperCase() : String(entry.code || '').trim(),
            logoUrl: info.logoUrl,
        };
    }

    /** slot (1..N) → draw lane row with crew/logo for the live race. */
    function mapSlotToDraw(slot, race, boatDirection, lookup) {
        const lanes = lanesInScreenOrder(race, boatDirection);
        const idx = Number(slot) - 1;
        if (!Number.isFinite(idx) || idx < 0 || idx >= lanes.length) return null;
        return enrichLaneEntry(lanes[idx], lookup);
    }

    /** Attach crew/logo to each CV boat using slot → draw mapping. */
    function enrichCvBoats(data, race, lookup) {
        const boats = Array.isArray(data?.boats) ? data.boats : [];
        const direction =
            data?.boat_direction ||
            data?.boatDirection ||
            (data?.venue === 'twizel' ? 'right_to_left' : 'left_to_right');
        return boats.map((boat) => {
            const draw = mapSlotToDraw(boat.slot, race, direction, lookup);
            return {
                ...boat,
                drawLane: draw?.lane ?? null,
                label: draw?.label || null,
                shortLabel: draw?.shortLabel || null,
                logoUrl: draw?.logoUrl || null,
            };
        });
    }

    /** Pick draw lane nearest to CV leader x,y. */
    function leaderDrawLane(data, race, lookup) {
        const enriched = enrichCvBoats(data, race, lookup);
        if (!enriched.length) return null;
        const lx = Number(data?.x);
        const ly = Number(data?.y);
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null;
        let best = null;
        let bestDist = Infinity;
        for (const boat of enriched) {
            const dist = Math.abs(Number(boat.x) - lx) + Math.abs(Number(boat.y) - ly);
            if (dist < bestDist) {
                bestDist = dist;
                best = boat;
            }
        }
        return best?.drawLane ?? null;
    }

    global.AltitudeHdCvBoatMap = {
        normalizeDirection,
        lanesInScreenOrder,
        mapSlotToDraw,
        enrichCvBoats,
        leaderDrawLane,
    };
})(typeof window !== 'undefined' ? window : globalThis);
