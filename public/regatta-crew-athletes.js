/**
 * Shared regatta crew → athlete mapping (competitors CSV + daysheet lane draw).
 * Used by KRI safety map and rowing regatta dashboard.
 */
(function (global) {
    function isRoundLabel(raw) {
        return /^(heat|final|repechage|rep|semi|semifinal|quarter|quarterfinal|timed)$/i.test(String(raw || '').trim());
    }

    /** RowIT progression strings (e.g. "1=FA; 2-8=R") are not event types. */
    function isProgressionFormat(raw) {
        const t = String(raw || '');
        return /[;=]|(?:^|[\s,])(?:FA|FB|FC|SA|SB|SC|Rest)(?:$|[\s,;])|\d+\s*-\s*\d+\s*=/.test(t);
    }

    /** Athletes per boat from a boat/event code, e.g. 1X→1, 4X+→5, 8+→9. */
    function athletesPerBoatFromCode(raw) {
        if (!raw || isRoundLabel(raw) || isProgressionFormat(raw)) return null;
        const t = String(raw).toUpperCase().replace(/\s+/g, '');
        if (/8X\+/.test(t)) return 9;
        if (/8\+/.test(t) && !/8X/.test(t)) return 9;
        if (/4X\+/.test(t)) return 5;
        if (/4\+/.test(t) && !/4X/.test(t)) return 5;
        if (/1X/.test(t)) return 1;
        if (/2X/.test(t)) return 2;
        if (/2\+/.test(t)) return 2;
        if (/2-$/.test(t) && !/\d-\d/.test(t)) return 2;
        if (/4X/.test(t)) return 4;
        if (/4-$/.test(t) && !/\d-\d/.test(t)) return 4;
        if (/8X/.test(t)) return 8;
        if (/8-$/.test(t) && !/\d-\d/.test(t)) return 8;
        return null;
    }

    /** @deprecated use resolveAthletesPerBoat — kept for callers that pass a known event code. */
    function athletesPerBoat(eventType) {
        return athletesPerBoatFromCode(eventType) ?? 1;
    }

    function athletesFromExpandedTitle(raw) {
        const t = String(raw || '').toLowerCase();
        if (!t) return null;
        if (/\beight\b|\bcoxed\s+eight\b|\b8\+|\b8x\+/.test(t)) return 9;
        if (/\bcoxed\s+four\b|\b4\+|\b4x\+/.test(t)) return 5;
        if (/\bcoxed\s+quad\b|\bquad\b/.test(t) && /\+|cox/.test(t)) return 5;
        if (/\bfour\b/.test(t) && !/\beight\b/.test(t)) return 4;
        if (/\bpair\b|\bcoxless\s+pair\b|\bdouble\s+scull\b|\b2x\b|\b2-\b|\b2\+\b/.test(t)) return 2;
        if (/\bsingle\b|\b1x\b/.test(t) && !/\bdouble\b/.test(t)) return 1;
        return null;
    }

    function eventMetaForRace(race, eventsByNum) {
        if (!eventsByNum || !race?.eventNum) return null;
        return eventsByNum.get(race.eventNum) || eventsByNum.get(String(parseInt(race.eventNum, 10))) || null;
    }

    function resolveAthletesPerBoat(race, row, eventMeta) {
        const candidates = [row?.eventType, race?.eventName, eventMeta?.name, eventMeta?.boat];
        for (const c of candidates) {
            const n = athletesPerBoatFromCode(c);
            if (n != null) return n;
        }
        for (const c of [race?.eventName, eventMeta?.displayName, eventMeta?.name]) {
            const n = athletesFromExpandedTitle(c);
            if (n != null) return n;
        }
        return 1;
    }

    function parseAthleteNames(namesStr) {
        if (!namesStr) return [];
        return namesStr
            .split(/[,;]|\s+\band\b|\s*&\s*/i)
            .map((s) => s.trim())
            .filter((s) => s.length > 1);
    }

    function findCompetitorRow(competitors, race) {
        if (!race || !competitors?.size) return null;
        const div = race.division ? String(race.division).trim() : '';
        const eventNum = race.eventNum ? String(race.eventNum).trim() : '';

        const exact = competitors.get(`${race.race}|${div}`);
        if (exact?.names) return exact;

        for (const [, row] of competitors) {
            if (row.race === race.race && row.division === div && row.names) return row;
        }
        for (const [, row] of competitors) {
            if (row.raceNum === race.raceNum && row.race === race.race && row.names) return row;
        }
        for (const [, row] of competitors) {
            if (row.raceNum !== race.raceNum || row.division !== div || !row.names) continue;
            if (eventNum && row.eventNum && row.eventNum !== eventNum) continue;
            return row;
        }
        return null;
    }

    /** Lane number → athlete names for one race (names in col G, lane order from daysheet draw). */
    function buildLaneAthletesMap(race, competitors, options) {
        const map = new Map();
        if (!race?.lanes?.length) return map;

        const row = findCompetitorRow(competitors, race);
        if (!row?.names) return map;

        const eventMeta = options?.eventMeta ?? eventMetaForRace(race, options?.eventsByNum);
        const perBoat = resolveAthletesPerBoat(race, row, eventMeta);
        const allNames = parseAthleteNames(row.names);
        const lanesWithCrew = race.lanes.filter((l) => l.crew).sort((a, b) => a.lane - b.lane);

        let idx = 0;
        for (const { lane } of lanesWithCrew) {
            const chunk = [];
            for (let i = 0; i < perBoat && idx < allNames.length; i++) {
                chunk.push(allNames[idx]);
                idx += 1;
            }
            if (chunk.length) map.set(lane, chunk);
        }
        return map;
    }

    function athletesForLane(race, lane, competitors, options) {
        if (!race || !lane) return [];
        return buildLaneAthletesMap(race, competitors, options).get(lane) || [];
    }

    global.RegattaCrewAthletes = {
        athletesPerBoat,
        athletesPerBoatFromCode,
        resolveAthletesPerBoat,
        parseAthleteNames,
        findCompetitorRow,
        buildLaneAthletesMap,
        athletesForLane,
    };
})(typeof window !== 'undefined' ? window : globalThis);
