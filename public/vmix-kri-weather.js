/**
 * KRI Lake Karāpiro live weather map for vMix (Open-Meteo, no API key).
 * Standalone: vmix-kri-weather.html · embedded: KriVmixWeather.show() from vmix-kri.html (M).
 */
(function (global) {
    const LAKE = {
        center: { lat: -37.936, lon: 175.55 },
        bounds: [
            [-37.948, 175.532],
            [-37.918, 175.578],
        ],
        gridCols: 4,
        gridRows: 3,
        zoom: 14,
    };

    const REFRESH_MS = 10 * 60 * 1000;
    const TIMEZONE = 'Pacific/Auckland';
    const INTRO_MS = 650;
    const OUTRO_MS = 650;

    const WMO_LABELS = {
        0: 'Clear',
        1: 'Mainly clear',
        2: 'Partly cloudy',
        3: 'Overcast',
        45: 'Fog',
        48: 'Fog',
        51: 'Light drizzle',
        53: 'Drizzle',
        55: 'Heavy drizzle',
        61: 'Light rain',
        63: 'Rain',
        65: 'Heavy rain',
        71: 'Light snow',
        73: 'Snow',
        75: 'Heavy snow',
        80: 'Showers',
        81: 'Showers',
        82: 'Heavy showers',
        95: 'Thunderstorm',
        96: 'Thunderstorm',
        99: 'Thunderstorm',
    };

    let panel = null;
    let map = null;
    let windLayer = null;
    let tempLayer = null;
    let rainLayer = null;
    let refreshTimer = null;
    let fadeTimer = null;

    function el(id) {
        return document.getElementById(id);
    }

    function wait(ms) {
        return new Promise((resolve) => {
            fadeTimer = setTimeout(resolve, ms);
        });
    }

    function wmoLabel(code) {
        return WMO_LABELS[code] || 'Mixed';
    }

    function windCompass(deg) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
        return dirs[idx];
    }

    function formatUpdated(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleString(undefined, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: TIMEZONE,
        });
    }

    function formatHour(iso) {
        const d = new Date(iso);
        return d
            .toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                timeZone: TIMEZONE,
            })
            .toLowerCase();
    }

    function gridPoints() {
        const [[south, west], [north, east]] = LAKE.bounds;
        const pts = [];
        for (let row = 0; row < LAKE.gridRows; row++) {
            const lat = north - ((north - south) * row) / Math.max(1, LAKE.gridRows - 1);
            for (let col = 0; col < LAKE.gridCols; col++) {
                const lon = west + ((east - west) * col) / Math.max(1, LAKE.gridCols - 1);
                pts.push({ lat, lon, key: `${row}-${col}` });
            }
        }
        return pts;
    }

    async function fetchPointWeather(lat, lon) {
        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            current: [
                'temperature_2m',
                'relative_humidity_2m',
                'wind_speed_10m',
                'wind_direction_10m',
                'precipitation',
                'weather_code',
            ].join(','),
            hourly: [
                'temperature_2m',
                'precipitation_probability',
                'precipitation',
                'wind_speed_10m',
                'wind_direction_10m',
            ].join(','),
            forecast_hours: '4',
            timezone: TIMEZONE,
            wind_speed_unit: 'kmh',
            precipitation_unit: 'mm',
        });
        const url = `https://api.open-meteo.com/v1/forecast?${params}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Weather API ${res.status}`);
        return res.json();
    }

    function statHtml(label, value, sub) {
        return (
            `<div class="kri-weather-stat">` +
            `<span class="kri-weather-stat__label">${label}</span>` +
            `<span class="kri-weather-stat__value">${value}</span>` +
            (sub ? `<span class="kri-weather-stat__sub">${sub}</span>` : '') +
            `</div>`
        );
    }

    function renderCurrent(current) {
        const grid = el('kriWeatherCurrentGrid');
        if (!grid || !current) return;
        const temp = Math.round(current.temperature_2m);
        const wind = Math.round(current.wind_speed_10m);
        const dir = Math.round(current.wind_direction_10m);
        const rain = current.precipitation ?? 0;
        const hum = current.relative_humidity_2m;
        grid.innerHTML =
            statHtml('Temperature', `${temp}°C`, wmoLabel(current.weather_code)) +
            statHtml('Wind', `${wind} km/h`, `${windCompass(dir)} · ${dir}°`) +
            statHtml('Rainfall', `${rain.toFixed(1)} mm/h`, rain > 0 ? 'Active now' : 'None now') +
            statHtml('Humidity', `${hum}%`, 'Relative');
    }

    function renderForecast(hourly) {
        const list = el('kriWeatherForecastList');
        if (!list || !hourly?.time?.length) return;
        const items = [];
        for (let i = 1; i <= 3 && i < hourly.time.length; i++) {
            const temp = Math.round(hourly.temperature_2m[i]);
            const wind = Math.round(hourly.wind_speed_10m[i]);
            const dir = windCompass(hourly.wind_direction_10m[i]);
            const rainProb = hourly.precipitation_probability[i];
            const rainMm = hourly.precipitation[i];
            items.push(
                `<li class="kri-weather-forecast-item">` +
                `<span class="kri-weather-forecast-item__time">${formatHour(hourly.time[i])}</span>` +
                `<span>${temp}°C · ${wind} km/h ${dir}</span>` +
                `<span class="kri-weather-forecast-item__rain">${rainProb}% · ${Number(rainMm).toFixed(1)} mm</span>` +
                `</li>`,
            );
        }
        list.innerHTML = items.join('');
    }

    function windArrowHtml(speedKmh, dirFromDeg) {
        const len = Math.min(52, Math.max(16, speedKmh * 2.8));
        const blowTo = dirFromDeg + 180;
        return (
            `<div class="kri-wind-arrow" style="transform: rotate(${blowTo}deg); width:${len}px">` +
            `<span class="kri-wind-arrow__shaft" style="width:${Math.max(8, len - 10)}px"></span>` +
            `<span class="kri-wind-arrow__head"></span>` +
            `</div>`
        );
    }

    function windIcon(speedKmh, dirFromDeg) {
        return L.divIcon({
            className: 'kri-wind-arrow-wrap',
            html: windArrowHtml(speedKmh, dirFromDeg),
            iconSize: [56, 16],
            iconAnchor: [28, 8],
        });
    }

    function tempIcon(tempC) {
        return L.divIcon({
            className: 'kri-weather-temp-wrap',
            html: `<div class="kri-weather-temp-label">${Math.round(tempC)}°</div>`,
            iconSize: [40, 22],
            iconAnchor: [20, 11],
        });
    }

    function rainRadiusMm(mm) {
        if (mm <= 0) return 0;
        return Math.min(28, 8 + mm * 12);
    }

    function clearMapLayers() {
        if (windLayer) windLayer.clearLayers();
        if (tempLayer) tempLayer.clearLayers();
        if (rainLayer) rainLayer.clearLayers();
    }

    function renderMapOverlays(gridData) {
        if (!map) return;
        clearMapLayers();

        for (const pt of gridData) {
            const cur = pt.data?.current;
            if (!cur) continue;

            const latlng = [pt.lat, pt.lon];
            windLayer.addLayer(
                L.marker(latlng, {
                    icon: windIcon(cur.wind_speed_10m, cur.wind_direction_10m),
                    interactive: false,
                }),
            );

            tempLayer.addLayer(
                L.marker([pt.lat + 0.0018, pt.lon], {
                    icon: tempIcon(cur.temperature_2m),
                    interactive: false,
                }),
            );

            const r = rainRadiusMm(cur.precipitation);
            if (r > 0) {
                rainLayer.addLayer(
                    L.circle(latlng, {
                        radius: r * 8,
                        stroke: true,
                        weight: 1,
                        color: 'rgba(0, 96, 191, 0.55)',
                        fillColor: '#38bdf8',
                        fillOpacity: 0.35,
                        className: 'kri-weather-rain-dot',
                        interactive: false,
                    }),
                );
            }
        }
    }

    function setStatus(msg, isError) {
        const status = el('kriWeatherStatus');
        const stage = panel || el('kriWeatherStage');
        if (status) status.textContent = msg || '';
        document.body.classList.toggle('kri-weather-page--error', !!isError);
        if (stage && isError) stage.setAttribute('data-weather-error', '1');
        else if (stage) stage.removeAttribute('data-weather-error');
    }

    async function refreshWeather() {
        setStatus('Updating…');
        try {
            const centerData = await fetchPointWeather(LAKE.center.lat, LAKE.center.lon);
            const points = gridPoints();
            const gridResults = await Promise.all(
                points.map(async (pt) => {
                    const data = await fetchPointWeather(pt.lat, pt.lon);
                    return { ...pt, data };
                }),
            );

            renderCurrent(centerData.current);
            renderForecast(centerData.hourly);
            renderMapOverlays(gridResults);

            const updated = el('kriWeatherUpdated');
            if (updated) {
                updated.textContent = `Updated ${formatUpdated(centerData.current?.time || new Date().toISOString())}`;
            }
            setStatus(`Open-Meteo · refreshes every ${REFRESH_MS / 60000} min`);
        } catch (err) {
            setStatus(err instanceof Error ? err.message : 'Weather update failed', true);
        }
    }

    function destroyMap() {
        if (map) {
            map.remove();
            map = null;
        }
        windLayer = null;
        tempLayer = null;
        rainLayer = null;
    }

    function initMap() {
        const container = el('kriWeatherMap');
        if (!container || map) return;

        map = L.map(container, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            touchZoom: false,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            opacity: 0.85,
        }).addTo(map);

        map.fitBounds(LAKE.bounds, { padding: [40, 40] });

        if (!map.getPane('kriWindPane')) {
            map.createPane('kriWindPane');
            map.getPane('kriWindPane').style.zIndex = 450;
        }
        if (!map.getPane('kriTempPane')) {
            map.createPane('kriTempPane');
            map.getPane('kriTempPane').style.zIndex = 460;
        }
        if (!map.getPane('kriRainPane')) {
            map.createPane('kriRainPane');
            map.getPane('kriRainPane').style.zIndex = 440;
        }

        windLayer = L.layerGroup([], { pane: 'kriWindPane' }).addTo(map);
        tempLayer = L.layerGroup([], { pane: 'kriTempPane' }).addTo(map);
        rainLayer = L.layerGroup([], { pane: 'kriRainPane' }).addTo(map);
    }

    function startRefreshTimer() {
        if (refreshTimer) return;
        refreshTimer = setInterval(refreshWeather, REFRESH_MS);
    }

    function stopRefreshTimer() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = null;
    }

    function buildPanelMarkup() {
        return (
            '<div class="kri-weather-map" id="kriWeatherMap" aria-hidden="true"></div>' +
            '<div class="kri-weather-vignette" aria-hidden="true"></div>' +
            '<img class="kri-weather-logo" src="assets/kri/kri-logo-full.png" alt="" width="360" height="80">' +
            '<aside class="kri-weather-panel" aria-live="polite">' +
            '<header class="kri-weather-panel__head">' +
            '<p class="kri-weather-panel__kicker">Lake Karāpiro</p>' +
            '<h1 class="kri-weather-panel__title">Live weather</h1>' +
            '<p class="kri-weather-panel__updated" id="kriWeatherUpdated">Loading…</p>' +
            '</header>' +
            '<section class="kri-weather-current" id="kriWeatherCurrent">' +
            '<h2 class="kri-weather-section-title">Current</h2>' +
            '<div class="kri-weather-current-grid" id="kriWeatherCurrentGrid"></div>' +
            '</section>' +
            '<section class="kri-weather-forecast" id="kriWeatherForecast">' +
            '<h2 class="kri-weather-section-title">Next 3 hours</h2>' +
            '<ul class="kri-weather-forecast-list" id="kriWeatherForecastList"></ul>' +
            '</section>' +
            '<p class="kri-weather-status" id="kriWeatherStatus"></p>' +
            '</aside>' +
            '<p class="kri-weather-legend" id="kriWeatherLegend">' +
            'Wind arrows show direction and strength (10 m). Rain circles = current rainfall intensity.' +
            '</p>'
        );
    }

    function ensurePanel(root) {
        const existing = document.getElementById('kriWeatherStage');
        if (existing) {
            panel = existing;
            return panel;
        }
        if (panel) return panel;
        const host = root || document.querySelector('.vg-stage');
        if (!host) return null;
        panel = document.createElement('div');
        panel.id = 'kriWeatherStage';
        panel.className = 'kri-weather-stage vg-kri-weather';
        panel.setAttribute('role', 'img');
        panel.setAttribute('aria-label', 'Lake Karāpiro live weather');
        panel.innerHTML = buildPanelMarkup();
        host.appendChild(panel);
        return panel;
    }

    async function show(opts = {}) {
        const host = opts.stage || document.querySelector('.vg-stage');
        ensurePanel(host);
        if (!panel) return;

        initMap();
        await refreshWeather();
        startRefreshTimer();

        panel.classList.remove('vg-kri-weather--outro', 'vg-kri-weather--hold');
        panel.classList.add('vg-kri-weather--intro');
        void panel.offsetWidth;
        panel.classList.add('vg-kri-weather--visible');

        await wait(INTRO_MS);
        panel.classList.remove('vg-kri-weather--intro');
        panel.classList.add('vg-kri-weather--hold');
        if (map) map.invalidateSize();
    }

    async function hide() {
        if (!panel) return;
        panel.classList.remove('vg-kri-weather--hold', 'vg-kri-weather--intro');
        panel.classList.add('vg-kri-weather--outro');
        await wait(OUTRO_MS);
        remove();
    }

    function remove() {
        if (fadeTimer) clearTimeout(fadeTimer);
        fadeTimer = null;
        stopRefreshTimer();
        destroyMap();
        const standalone = document.body.classList.contains('kri-weather-page');
        if (panel) {
            panel.classList.remove(
                'vg-kri-weather--visible',
                'vg-kri-weather--intro',
                'vg-kri-weather--hold',
                'vg-kri-weather--outro',
            );
            if (!standalone) {
                panel.remove();
                panel = null;
            }
        }
    }

    function startStandalone() {
        panel = document.getElementById('kriWeatherStage');
        if (!panel) return;
        initMap();
        refreshWeather();
        startRefreshTimer();
        panel.classList.add('vg-kri-weather--visible', 'vg-kri-weather--hold');
        if (map) map.invalidateSize();
    }

    if (document.body.classList.contains('kri-weather-page')) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startStandalone);
        } else {
            startStandalone();
        }
    }

    global.KriVmixWeather = {
        INTRO_MS,
        OUTRO_MS,
        LAKE,
        refresh: refreshWeather,
        show,
        hide,
        remove,
    };
})(typeof window !== 'undefined' ? window : globalThis);
