/**
 * Built-in and user-saved beach sprint course venues (layout + optional buoys/flags).
 */
(function () {
    const LS_USER_VENUES = 'bspCourseVenuePresets_v1';
    const LS_ACTIVE_VENUE = 'bspActiveCourseVenue_v1';

    const DEFAULT_VENUE_ID = 'orewa';

    /** Start/finish and heading kept from prior CNZB map default; A/B/C per Orewa setup. */
    const BUILTIN_VENUES = [
        {
            id: 'orewa',
            name: 'Orewa, Auckland',
            builtin: true,
            layout: {
                originLat: -36.59205,
                originLng: 174.70355,
                headingDeg: 45,
                laneSpacingA: 25,
                buoySpacingB: 85,
                tideLineC: 50,
            },
        },
        {
            id: 'titahi-bay',
            name: 'Titahi Bay, Wellington',
            builtin: true,
            layout: {
                originLat: -36.59205,
                originLng: 174.70355,
                headingDeg: 45,
                laneSpacingA: 18,
                buoySpacingB: 85,
                tideLineC: 25,
            },
        },
    ];

    function slugify(name) {
        return String(name || 'venue')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 48) || 'venue';
    }

    function loadUserVenues() {
        try {
            const raw = localStorage.getItem(LS_USER_VENUES);
            const obj = raw ? JSON.parse(raw) : {};
            return obj && typeof obj === 'object' ? obj : {};
        } catch {
            return {};
        }
    }

    function saveUserVenues(obj) {
        try {
            localStorage.setItem(LS_USER_VENUES, JSON.stringify(obj));
        } catch (e) {
            console.warn('Could not save venue presets', e);
        }
    }

    function getBuiltinVenue(id) {
        return BUILTIN_VENUES.find((v) => v.id === id) || null;
    }

    function getVenue(id) {
        if (!id) return null;
        const builtin = getBuiltinVenue(id);
        if (builtin) return { ...builtin, layout: { ...builtin.layout } };
        const user = loadUserVenues()[id];
        if (!user) return null;
        return {
            id,
            name: user.name || id,
            builtin: false,
            layout: user.layout ? { ...user.layout } : null,
            buoys: user.buoys ? user.buoys.map((b) => ({ ...b })) : null,
            flags: user.flags ? user.flags.map((f) => ({ ...f })) : null,
        };
    }

    function listVenues() {
        const user = loadUserVenues();
        const merged = BUILTIN_VENUES.map((v) => ({ id: v.id, name: v.name, builtin: true }));
        Object.keys(user).forEach((id) => {
            if (!merged.some((v) => v.id === id)) {
                merged.push({ id, name: user[id].name || id, builtin: false });
            }
        });
        return merged;
    }

    function getActiveId() {
        try {
            return localStorage.getItem(LS_ACTIVE_VENUE) || '';
        } catch {
            return '';
        }
    }

    function setActiveId(id) {
        try {
            if (id) localStorage.setItem(LS_ACTIVE_VENUE, id);
            else localStorage.removeItem(LS_ACTIVE_VENUE);
        } catch {
            /* ignore */
        }
    }

    function saveVenueFromCurrent(name, snapshot) {
        const id = slugify(name);
        const user = loadUserVenues();
        user[id] = {
            name: String(name).trim() || id,
            layout: { ...snapshot.layout },
            buoys: snapshot.buoys ? snapshot.buoys.map((b) => ({ ...b })) : undefined,
            flags: snapshot.flags ? snapshot.flags.map((f) => ({ ...f })) : undefined,
            savedAt: new Date().toISOString(),
        };
        saveUserVenues(user);
        setActiveId(id);
        return id;
    }

    function deleteUserVenue(id) {
        if (getBuiltinVenue(id)) return false;
        const user = loadUserVenues();
        if (!user[id]) return false;
        delete user[id];
        saveUserVenues(user);
        if (getActiveId() === id) setActiveId(DEFAULT_VENUE_ID);
        return true;
    }

    function getDefaultVenue() {
        return getVenue(DEFAULT_VENUE_ID);
    }

    window.BspVenuePresets = {
        DEFAULT_VENUE_ID,
        BUILTIN_VENUES,
        slugify,
        listVenues,
        getVenue,
        getDefaultVenue,
        getActiveId,
        setActiveId,
        saveVenueFromCurrent,
        deleteUserVenue,
        isBuiltin: (id) => !!getBuiltinVenue(id),
    };
})();
