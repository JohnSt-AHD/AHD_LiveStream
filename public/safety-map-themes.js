/**
 * Safety map presets — RNZ RowSafe and KRI Lake Karāpiro.
 */
(function (global) {
    function matchesRnzGeofenceName(name) {
        if (!name || typeof name !== 'string') return false;
        const n = name.toLowerCase();
        return (
            n.includes('rowing') ||
            n.includes('rnz') ||
            n.includes('rowsafe') ||
            n.includes('rowinghub') ||
            n.includes('new zealand') ||
            n.includes('row nz')
        );
    }

    function matchesKriGeofenceName(name) {
        if (!name || typeof name !== 'string') return false;
        const n = name.toLowerCase();
        return (
            n.includes('karapiro') ||
            n.includes('karāpiro') ||
            n.includes('kri') ||
            n.includes('lake kar') ||
            n.includes('rowing inc') ||
            n.includes('course')
        );
    }

    function classifyKriGeofenceName(name) {
        if (!name || typeof name !== 'string') return 'other';
        const n = name.toLowerCase();
        if (n.includes('course')) return 'hidden';
        if (n.includes('dam') || n.includes('weed')) return 'hazard';
        if (matchesKriGeofenceName(name)) return 'boundary';
        return 'other';
    }

    global.SafetyMapThemes = {
        rnz: {
            id: 'rnz',
            lsStopped: 'rnzRowsafeStoppedOutside',
            matchGeofenceName: matchesRnzGeofenceName,
            boundaryLabel: 'Rowing NZ',
            boundaryPopup: 'RNZ boundary',
            emptyBoundaryHint:
                'Define circle/polygon geofences in Traccar to detect boats outside the Rowing NZ boundary.',
            mapCenter: [-36.85, 174.76],
            mapZoom: 5,
            geofenceMatchColor: '#0f766e',
            geofenceMatchFill: '#14b8a6',
            enableCapsize: false,
        },
        kri: {
            id: 'kri',
            lsStopped: 'kriSafetyStoppedOutside',
            matchGeofenceName: matchesKriGeofenceName,
            boundaryLabel: 'Lake Karāpiro / KRI',
            boundaryPopup: 'KRI boundary',
            emptyBoundaryHint:
                'Define geofences in Traccar for Lake Karāpiro (include “KRI” or “Karapiro” in the name).',
            mapCenter: [-37.936, 175.427],
            mapZoom: 14,
            geofenceMatchColor: '#1e40af',
            geofenceMatchFill: '#3b82f6',
            geofenceHazardColor: '#dc2626',
            geofenceHazardFill: '#ef4444',
            classifyGeofenceName: classifyKriGeofenceName,
            enableCapsize: true,
            enableCourseOverlay: true,
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
