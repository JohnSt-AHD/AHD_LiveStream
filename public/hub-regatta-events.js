/**
 * 2026–27 NZ regatta calendar — shared by hub stats bar (and optional DOM highlight on home).
 */
(function (global) {
    const EVENTS = [
        { start: '2026-09-19', end: '2026-09-20', name: 'New Zealand Master Rowing' },
        { start: '2026-11-14', end: '2026-11-15', name: 'KRI Memorial Rowing Regatta' },
        { start: '2026-11-28', end: '2026-11-29', name: 'KRI Club Regatta' },
        { start: '2026-12-11', end: '2026-12-13', name: 'KRI Christmas Regatta' },
        { start: '2027-01-29', end: '2027-01-31', name: 'North Island Rowing Champs' },
        { start: '2027-02-26', end: '2027-02-28', name: 'North Island Secondary School Rowing Regatta' },
        { start: '2027-03-15', end: '2027-03-20', name: 'Maadi Cup' },
    ];

    function labelFromEvents(events, now = new Date()) {
        for (const ev of events) {
            const start = new Date(`${ev.start}T00:00:00`);
            const end = new Date(`${ev.end}T23:59:59`);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
            if (now >= start && now <= end) {
                return `Now: ${ev.name}`;
            }
        }

        let next = null;
        let nextStart = null;
        for (const ev of events) {
            const start = new Date(`${ev.start}T00:00:00`);
            if (Number.isNaN(start.getTime()) || start <= now) continue;
            if (!nextStart || start < nextStart) {
                nextStart = start;
                next = ev;
            }
        }

        if (next && nextStart) {
            const days = Math.max(0, Math.ceil((nextStart - now) / 86400000));
            if (days === 0) return `Next: ${next.name} (today)`;
            if (days === 1) return `1 day to ${next.name}`;
            return `${days} days to ${next.name}`;
        }

        return 'No upcoming regattas';
    }

    global.HubRegattaEvents = {
        EVENTS,
        labelFromEvents,
    };
})(typeof window !== 'undefined' ? window : globalThis);
