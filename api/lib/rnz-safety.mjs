const STOP_SPEED_MPS = 0.5;
const STOP_MIN_MS = 30 * 60 * 1000;
const MOVE_RESET_M = 35;

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

function parseGeofenceArea(areaStr) {
    if (!areaStr || typeof areaStr !== 'string') return null;
    const s = areaStr.trim();
    const circleM = s.match(/CIRCLE\s*\(\s*([\d.-]+)\s+([\d.-]+)\s*,\s*([\d.]+)\s*\)/i);
    if (circleM) {
        return {
            type: 'circle',
            lat: parseFloat(circleM[1]),
            lon: parseFloat(circleM[2]),
            radiusM: parseFloat(circleM[3]),
        };
    }
    const polyM = s.match(/POLYGON\s*\(\s*\(\s*([^)]+)\)\s*\)/i);
    if (polyM) {
        const ring = [];
        for (const part of polyM[1].split(',')) {
            const bits = part.trim().split(/\s+/);
            if (bits.length >= 2) {
                const lat = parseFloat(bits[0]);
                const lon = parseFloat(bits[1]);
                if (!Number.isNaN(lat) && !Number.isNaN(lon)) ring.push([lat, lon]);
            }
        }
        if (ring.length >= 3) return { type: 'polygon', ring };
    }
    return null;
}

function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(lat2 - lat1);
    const dLon = toR(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const yi = ring[i][0];
        const xi = ring[i][1];
        const yj = ring[j][0];
        const xj = ring[j][1];
        const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

function isInsideBoundaryParts(lat, lon, parts) {
    for (const p of parts) {
        if (p.type === 'circle' && haversineM(lat, lon, p.lat, p.lon) <= p.radiusM + 1) return true;
        if (p.type === 'polygon' && pointInPolygon(lat, lon, p.ring)) return true;
    }
    return false;
}

export function getMatchedGeofences(all) {
    const list = Array.isArray(all) ? all : [];
    const named = list.filter((g) => g && matchesRnzGeofenceName(g.name));
    if (named.length > 0) return { geofences: named, mode: 'name' };
    const withArea = list.filter((g) => {
        const p = parseGeofenceArea(g && g.area);
        return p && (p.type === 'circle' || p.type === 'polygon');
    });
    return { geofences: withArea, mode: withArea.length ? 'all-shapes' : 'none' };
}

export function boundaryPartsFromGeofences(list) {
    const parts = [];
    for (const g of list) {
        const parsed = parseGeofenceArea(g && g.area);
        if (parsed && (parsed.type === 'circle' || parsed.type === 'polygon')) {
            parts.push(parsed);
        }
    }
    return parts;
}

export function mergeDevicesFromPositions(deviceList, positionsMap) {
    const list = Array.isArray(deviceList) ? deviceList.slice() : [];
    const seen = new Set(list.map((d) => d && d.id).filter((id) => id != null));
    for (const key of Object.keys(positionsMap)) {
        const id = Number(key);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        const pos = positionsMap[key];
        let name = `Device ${id}`;
        if (pos && typeof pos.deviceName === 'string' && pos.deviceName.trim()) {
            name = pos.deviceName.trim();
        }
        list.push({ id, name });
        seen.add(id);
    }
    return list;
}

export function updateStoppedTracking(devices, positions, parts, previousState = {}) {
    const now = Date.now();
    const deviceIds = new Set(devices.map((d) => d.id));
    const next = { ...previousState };

    for (const id of Object.keys(next)) {
        if (!deviceIds.has(Number(id))) delete next[id];
    }

    for (const d of devices) {
        const pos = positions[d.id];
        if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') {
            delete next[d.id];
            continue;
        }
        const outside = parts.length > 0 ? !isInsideBoundaryParts(pos.latitude, pos.longitude, parts) : false;
        const slow = typeof pos.speed === 'number' && pos.speed < STOP_SPEED_MPS;
        if (!outside || !slow || parts.length === 0) {
            delete next[d.id];
            continue;
        }
        const prev = next[d.id];
        if (!prev) {
            next[d.id] = { t: now, lat: pos.latitude, lng: pos.longitude };
            continue;
        }
        if (haversineM(prev.lat, prev.lng, pos.latitude, pos.longitude) > MOVE_RESET_M) {
            next[d.id] = { t: now, lat: pos.latitude, lng: pos.longitude };
        }
    }

    return next;
}

function isCriticalOutsideAlert(device, pos, parts, stoppedState) {
    if (!parts?.length) return false;
    if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') return false;
    if (isInsideBoundaryParts(pos.latitude, pos.longitude, parts)) return false;
    const fixMs = pos.fixTime ? new Date(pos.fixTime).getTime() : 0;
    const fixAgeMs = fixMs > 0 ? Date.now() - fixMs : Number.POSITIVE_INFINITY;
    const slow = typeof pos.speed === 'number' && pos.speed < STOP_SPEED_MPS;
    const st = stoppedState[device.id];
    const stationaryLong = slow && st && Date.now() - st.t >= STOP_MIN_MS;
    const offlineLong = fixAgeMs >= STOP_MIN_MS;
    return offlineLong || stationaryLong;
}

function warningDetailForDevice(device, pos, stoppedState) {
    const fixMs = pos.fixTime ? new Date(pos.fixTime).getTime() : 0;
    const fixAgeMs = fixMs > 0 ? Date.now() - fixMs : null;
    const slow = typeof pos.speed === 'number' && pos.speed < STOP_SPEED_MPS;
    const st = stoppedState[device.id];
    if (fixAgeMs != null && fixAgeMs < STOP_MIN_MS && slow && st) {
        return `Stationary outside ~${Math.floor((Date.now() - st.t) / 60000)} min`;
    }
    if (fixAgeMs != null && fixAgeMs >= STOP_MIN_MS) {
        return `Last fix ${Math.floor(fixAgeMs / 60000)} min ago`;
    }
    return 'No fix for 30+ min';
}

export function listWarningDetails(devices, positions, parts, stoppedState) {
    const list = [];
    if (!parts.length) return list;
    for (const d of devices) {
        const pos = positions[d.id];
        if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') continue;
        if (isInsideBoundaryParts(pos.latitude, pos.longitude, parts)) continue;
        if (!isCriticalOutsideAlert(d, pos, parts, stoppedState)) continue;
        list.push({
            deviceId: d.id,
            deviceName: d.name || `Device ${d.id}`,
            detail: warningDetailForDevice(d, pos, stoppedState),
        });
    }
    return list;
}

export function evaluateSafetySnapshot(devices, positions, geofences, stoppedStateIn = null) {
    const { geofences: matched } = getMatchedGeofences(geofences);
    const parts = boundaryPartsFromGeofences(matched);
    const stoppedState = updateStoppedTracking(devices, positions, parts, stoppedStateIn || {});
    const warnings = listWarningDetails(devices, positions, parts, stoppedState);
    return {
        boundaryReady: parts.length > 0,
        warnings,
        stoppedState,
    };
}
