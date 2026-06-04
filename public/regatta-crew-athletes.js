/**
 * Shared regatta crew → athlete mapping (competitors CSV + daysheet lane draw).
 * Used by KRI safety map and rowing regatta dashboard.
 */
(function (global) {
    /** Athletes per boat from event type (competitors col D), e.g. 1X→1, 4X+→5, 8X+→9. */
    function athletesPerBoat(eventType) {
        const t = String(eventType || '').toUpperCase().replace(/\s+/g, '');
        if (/8X\+/.test(t)) return 9;
        if (/8\+/.test(t) && !/8X/.test(t)) return 9;
        if (/4X\+/.test(t)) return 5;
        if (/4\+/.test(t) && !/4X/.test(t)) return 5;
        if (/1X/.test(t)) return 1;
        if (/2X|2-|2\+/.test(t)) return 2;
        if (/4X|4-|4\+/.test(t)) return 4;
        if (/8X|8-|8\+/.test(t)) return 8;
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
        const exact = competitors.get(`${race.race}|${div}`);
        if (exact?.names) return exact;

        for (const [, row] of competitors) {
            if (row.race === race.race && row.division === div && row.names) return row;
        }
        for (const [, row] of competitors) {
            if (row.raceNum === race.raceNum && row.race === race.race && row.names) return row;
        }
        for (const [, row] of competitors) {
            if (row.raceNum === race.raceNum && row.division === div && row.names) return row;
        }
        return null;
    }

    /** Lane number → athlete names for one race (names in col G, lane order from daysheet draw). */
    function buildLaneAthletesMap(race, competitors) {
        const map = new Map();
        if (!race?.lanes?.length) return map;

        const row = findCompetitorRow(competitors, race);
        if (!row?.names) return map;

        const eventType = row.eventType || race.eventName || '';
        const perBoat = athletesPerBoat(eventType);
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

    function athletesForLane(race, lane, competitors) {
        if (!race || !lane) return [];
        return buildLaneAthletesMap(race, competitors).get(lane) || [];
    }

    global.RegattaCrewAthletes = {
        athletesPerBoat,
        parseAthleteNames,
        findCompetitorRow,
        buildLaneAthletesMap,
        athletesForLane,
    };
})(typeof window !== 'undefined' ? window : globalThis);
