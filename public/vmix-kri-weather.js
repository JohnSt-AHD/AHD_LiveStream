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
    /** Evenly spaced display sites (×4 vs original 22); wind from nearest grid sample. */
    const WIND_SITE_COUNT = 88;
    /** Was 2× base; reduced 25% → 1.5× base. */
    const WIND_ARROW_SCALE = 1.5;
    const WIND_ARROW_OPACITY = 0.42;
    const WIND_SPEED_MIN_KMH = 0;
    const WIND_SPEED_MAX_KMH = 45;
    /** Wind colour scale — RGB lerp (avoids green when HSL hue wraps 240°→0°). */
    const WIND_COLOR_LOW = { r: 0, g: 121, b: 209 };
    const WIND_COLOR_HIGH = { r: 235, g: 59, b: 59 };
    const FORECAST_CHART_HOURS = 8;
    const RAIN_CHART_MAX_MM = 2;

    const CHART_SCALE = 1.2;
    const CHART_SIZE = { w: Math.round(328 * CHART_SCALE), h: Math.round(76 * CHART_SCALE) };
    const CHART_PAD = { l: 46, r: 10, t: 22, b: 26 };
    const CHART_THEME = {
        line: '#0079d1',
        lineSoft: 'rgba(0, 121, 209, 0.45)',
        fill: 'rgba(0, 121, 209, 0.2)',
        grid: 'rgba(0, 96, 191, 0.22)',
        bar: '#0079d1',
        barDeep: '#004a99',
        text: '#0060bf',
        textDark: '#0c1f3d',
        white: '#ffffff',
    };
    const ZOOM_IN_FACTOR = 1.386 * 1.1;
    const COURSE_BOUNDS_MARGIN = 0.0026;

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
    let courseLayer = null;
    let windLayer = null;
    let windLabelLayer = null;
    let decorativeWindLayer = null;
    let randomWindSites = [];
    let refreshTimer = null;
    let fadeTimer = null;
    /** Fixed center/zoom after first stable layout — stops fitBounds jumping on resize/intro. */
    let lockedMapView = null;

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

    function wmoIconKind(code) {
        const c = Number(code);
        if (c === 0) return 'sun';
        if (c === 1) return 'sun-cloud';
        if (c === 2 || c === 3 || c === 45 || c === 48) return 'cloud';
        if (c >= 51 && c <= 67) return 'rain';
        if (c >= 71 && c <= 77) return 'snow';
        if (c >= 80 && c <= 82) return 'rain';
        if (c >= 95) return 'storm';
        return 'cloud';
    }

    function weatherIconSvg(kind) {
        const sun = '<circle cx="32" cy="32" r="14" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5"/>';
        const cloud =
            '<path d="M22 42c0-8 6-14 14-14 2 0 4 .4 6 1.2 2.5-5 7.5-8.5 13.5-8.5 8 0 14.5 6 15 13.5 5 1 8.5 5.5 8.5 11 0 6.2-5 11.3-11.3 11.3H24c-5.5 0-10-4.5-10-10 0-4.8 3.4-8.8 8-9.5z" fill="#94a3b8" stroke="#64748b" stroke-width="1.2"/>';
        const rain =
            '<path d="M28 50v8M36 48v10M44 50v8" stroke="#0079d1" stroke-width="2.5" stroke-linecap="round"/>';
        const snow =
            '<path d="M32 48v10M28 52h8M29 56l6-4M29 48l6 4" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>';
        const bolt =
            '<path d="M38 26l-8 14h6l-4 12 14-18h-7l3-8z" fill="#fbbf24" stroke="#f59e0b" stroke-width="0.8"/>';

        let body = cloud;
        if (kind === 'sun') body = sun;
        else if (kind === 'sun-cloud') body = sun + cloud;
        else if (kind === 'rain') body = cloud + rain;
        else if (kind === 'snow') body = cloud + snow;
        else if (kind === 'storm') body = cloud + bolt + rain;

        return (
            `<svg class="kri-weather-condition-icon__svg" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">` +
            body +
            `</svg>`
        );
    }

    function renderConditionIcon(weatherCode) {
        const iconEl = el('kriWeatherConditionIcon');
        if (!iconEl) return;
        const kind = wmoIconKind(weatherCode);
        iconEl.innerHTML = weatherIconSvg(kind);
        iconEl.dataset.weatherKind = kind;
        iconEl.title = wmoLabel(weatherCode);
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
            forecast_hours: String(FORECAST_CHART_HOURS),
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
        renderConditionIcon(current.weather_code);
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

    function escapeXml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function sliceHourlyForecast(hourly, hours) {
        if (!hourly?.time?.length) return null;
        const n = Math.min(hours, hourly.time.length);
        return {
            labels: hourly.time.slice(0, n).map((t, i) => (i % 2 === 0 ? formatHour(t) : '')),
            temp: hourly.temperature_2m.slice(0, n).map(Number),
            wind: hourly.wind_speed_10m.slice(0, n).map(Number),
            rain: hourly.precipitation.slice(0, n).map((v) => Number(v) || 0),
        };
    }

    function chartPlotRect() {
        const { w, h } = CHART_SIZE;
        const p = CHART_PAD;
        return {
            w,
            h,
            plotW: w - p.l - p.r,
            plotH: h - p.t - p.b,
            ...p,
        };
    }

    function chartX(index, count, rect) {
        if (count <= 1) return rect.l + rect.plotW / 2;
        return rect.l + (index / (count - 1)) * rect.plotW;
    }

    function chartY(value, yMin, yMax, rect) {
        const span = yMax - yMin || 1;
        return rect.t + rect.plotH - ((value - yMin) / span) * rect.plotH;
    }

    function chartGridSvg(rect, yMin, yMax, yUnit) {
        const lines = [];
        const labels = [];
        for (let i = 0; i <= 2; i++) {
            const t = i / 2;
            const yVal = yMin + (yMax - yMin) * (1 - t);
            const y = rect.t + t * rect.plotH;
            lines.push(
                `<line x1="${rect.l}" y1="${y.toFixed(1)}" x2="${(rect.l + rect.plotW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${CHART_THEME.grid}" stroke-width="1"/>`,
            );
            if (i === 0 || i === 2) {
                const label =
                    i === 0
                        ? `${Math.round(yMax)}${yUnit}`
                        : `${Math.round(yMin)}${yUnit}`;
                labels.push(
                    `<text x="${rect.l - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="kri-weather-chart__axis">${escapeXml(label)}</text>`,
                );
            }
        }
        return lines.join('') + labels.join('');
    }

    function chartXLabelsSvg(labels, count, rect) {
        let out = '';
        for (let i = 0; i < count; i++) {
            if (!labels[i]) continue;
            const x = chartX(i, count, rect);
            out += `<text x="${x.toFixed(1)}" y="${(rect.t + rect.plotH + 14).toFixed(1)}" text-anchor="middle" class="kri-weather-chart__axis">${escapeXml(labels[i])}</text>`;
        }
        return out;
    }

    function buildLineChartSvg({ title, values, labels, yMin, yMax, yUnit }) {
        const rect = chartPlotRect();
        const n = values.length;
        if (n < 1) {
            return `<svg viewBox="0 0 ${rect.w} ${rect.h}" class="kri-weather-chart__svg" aria-hidden="true"></svg>`;
        }
        const y0 = chartY(yMin, yMin, yMax, rect);
        const pts = values.map((v, i) => ({
            x: chartX(i, n, rect),
            y: chartY(v, yMin, yMax, rect),
        }));
        const linePath = pts
            .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' ');
        const areaPath =
            linePath +
            ` L${pts[n - 1].x.toFixed(1)},${y0.toFixed(1)} L${pts[0].x.toFixed(1)},${y0.toFixed(1)} Z`;

        return (
            `<svg viewBox="0 0 ${rect.w} ${rect.h}" class="kri-weather-chart__svg" role="img" aria-label="${escapeXml(title)}">` +
            `<text x="${rect.l}" y="12" class="kri-weather-chart__title">${escapeXml(title)}</text>` +
            chartGridSvg(rect, yMin, yMax, yUnit) +
            `<path d="${areaPath}" fill="${CHART_THEME.fill}"/>` +
            `<path d="${linePath}" fill="none" stroke="${CHART_THEME.line}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
            pts
                .map(
                    (p) =>
                        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${CHART_THEME.white}" stroke="${CHART_THEME.line}" stroke-width="2"/>`,
                )
                .join('') +
            chartXLabelsSvg(labels, n, rect) +
            `</svg>`
        );
    }

    function buildBarChartSvg({ title, values, labels, yMax, yUnit }) {
        const rect = chartPlotRect();
        const n = values.length;
        if (n < 1) {
            return `<svg viewBox="0 0 ${rect.w} ${rect.h}" class="kri-weather-chart__svg" aria-hidden="true"></svg>`;
        }
        const yMin = 0;
        const slot = rect.plotW / n;
        const barW = Math.max(6, slot * 0.62);
        let bars = '';
        for (let i = 0; i < n; i++) {
            const v = Math.min(yMax, Math.max(0, values[i]));
            const x = rect.l + i * slot + (slot - barW) / 2;
            const yTop = chartY(v, yMin, yMax, rect);
            const yBase = chartY(0, yMin, yMax, rect);
            const h = Math.max(0, yBase - yTop);
            const fill = v >= yMax * 0.85 ? CHART_THEME.barDeep : CHART_THEME.bar;
            bars += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}"/>`;
        }

        return (
            `<svg viewBox="0 0 ${rect.w} ${rect.h}" class="kri-weather-chart__svg" role="img" aria-label="${escapeXml(title)}">` +
            `<text x="${rect.l}" y="12" class="kri-weather-chart__title">${escapeXml(title)}</text>` +
            chartGridSvg(rect, yMin, yMax, yUnit) +
            bars +
            chartXLabelsSvg(labels, n, rect) +
            `</svg>`
        );
    }

    function renderForecastCharts(hourly) {
        const tempHost = el('kriWeatherChartTemp');
        const windHost = el('kriWeatherChartWind');
        const rainHost = el('kriWeatherChartRain');
        if (!tempHost || !windHost || !rainHost) return;

        const data = sliceHourlyForecast(hourly, FORECAST_CHART_HOURS);
        if (!data) {
            tempHost.innerHTML = '';
            windHost.innerHTML = '';
            rainHost.innerHTML = '';
            return;
        }

        const tempMin = Math.floor(Math.min(...data.temp) - 1);
        const tempMax = Math.ceil(Math.max(...data.temp) + 1);
        tempHost.innerHTML = buildLineChartSvg({
            title: 'Temperature — next 8 hr',
            values: data.temp,
            labels: data.labels,
            yMin: tempMin,
            yMax: Math.max(tempMin + 1, tempMax),
            yUnit: '°',
        });

        const windMax = Math.ceil(Math.max(8, ...data.wind) + 2);
        windHost.innerHTML = buildLineChartSvg({
            title: 'Wind (km/h) — next 8 hr',
            values: data.wind,
            labels: data.labels,
            yMin: 0,
            yMax: windMax,
            yUnit: '',
        });

        rainHost.innerHTML = buildBarChartSvg({
            title: 'Rainfall (0–2 mm/h) — next 8 hr',
            values: data.rain,
            labels: data.labels,
            yMax: RAIN_CHART_MAX_MM,
            yUnit: ' mm',
        });
    }

    function normalizeDeg(deg) {
        return ((deg % 360) + 360) % 360;
    }

    function getCourseBearing() {
        if (global.KriRowingCourseOverlay?.buildCourseFrame) {
            return global.KriRowingCourseOverlay.buildCourseFrame().bearing;
        }
        return 0;
    }

    /** Wind FROM direction relative to course bearing (bow = 0°). */
    function relativeWindDeg(windFromDeg, courseBearing) {
        return normalizeDeg(Number(windFromDeg) - courseBearing);
    }

    function windRelativeToBoat(relativeDeg) {
        const d = normalizeDeg(relativeDeg);
        if (d >= 337.5 || d < 22.5) return { type: 'head', label: 'Head wind' };
        if (d >= 22.5 && d < 67.5) return { type: 'side', label: 'Side wind' };
        if (d >= 67.5 && d < 112.5) return { type: 'tail', label: 'Tail wind' };
        if (d >= 112.5 && d < 157.5) return { type: 'side', label: 'Side wind' };
        if (d >= 157.5 && d < 247.5) return { type: 'tail', label: 'Tail wind' };
        return { type: 'side', label: 'Side wind' };
    }

    function rowingPaceLabel(speedKmh, isTailwind) {
        const speed = Number(speedKmh);
        if (!Number.isFinite(speed)) return '—';
        if (speed > 20) return 'Rough conditions';
        if (speed < 5 || (isTailwind && speed <= 20)) return 'Fast conditions';
        if (speed >= 5 && speed < 10) return 'Moderate conditions';
        if (speed >= 10 && speed <= 20) return 'Slow conditions';
        return 'Moderate conditions';
    }

    function rowingScullSvg(courseBearing, windFromDeg) {
        const rel = relativeWindDeg(windFromDeg, courseBearing);
        const rad = (rel * Math.PI) / 180;
        const wx1 = 100 + 82 * Math.sin(rad);
        const wy1 = 100 - 82 * Math.cos(rad);
        const wx2 = 100 + 46 * Math.sin(rad);
        const wy2 = 100 - 46 * Math.cos(rad);
        const boatRotate = normalizeDeg(courseBearing);
        return (
            `<svg class="kri-weather-rowing__svg" viewBox="0 0 200 200" aria-hidden="true">` +
            `<circle cx="100" cy="100" r="92" fill="rgba(0, 121, 209, 0.08)" stroke="rgba(0, 121, 209, 0.2)" stroke-width="1"/>` +
            `<line x1="${wx1.toFixed(1)}" y1="${wy1.toFixed(1)}" x2="${wx2.toFixed(1)}" y2="${wy2.toFixed(1)}" class="kri-weather-rowing__wind-line"/>` +
            `<polygon points="${wx2.toFixed(1)},${wy2.toFixed(1)} ${(wx2 - 6 * Math.cos(rad)).toFixed(1)},${(wy2 - 6 * Math.sin(rad)).toFixed(1)} ${(wx2 + 6 * Math.sin(rad)).toFixed(1)},${(wy2 - 6 * Math.cos(rad)).toFixed(1)}" class="kri-weather-rowing__wind-head"/>` +
            `<g class="kri-weather-rowing__boat" transform="rotate(${boatRotate.toFixed(1)} 100 100)">` +
            `<ellipse cx="100" cy="100" rx="14" ry="52" fill="#ffffff" stroke="#0079d1" stroke-width="3"/>` +
            `<ellipse cx="100" cy="78" rx="9" ry="16" fill="rgba(0, 121, 209, 0.12)"/>` +
            `<circle cx="100" cy="96" r="5" fill="#0079d1"/>` +
            `<line x1="100" y1="88" x2="100" y2="108" stroke="#0079d1" stroke-width="2.5"/>` +
            `<line x1="62" y1="96" x2="138" y2="96" stroke="#0060bf" stroke-width="2.5" stroke-linecap="round"/>` +
            `<line x1="62" y1="96" x2="38" y2="88" stroke="#0079d1" stroke-width="3" stroke-linecap="round"/>` +
            `<line x1="62" y1="96" x2="38" y2="104" stroke="#0079d1" stroke-width="3" stroke-linecap="round"/>` +
            `<line x1="138" y1="96" x2="162" y2="88" stroke="#0079d1" stroke-width="3" stroke-linecap="round"/>` +
            `<line x1="138" y1="96" x2="162" y2="104" stroke="#0079d1" stroke-width="3" stroke-linecap="round"/>` +
            `<path d="M100 48 L94 58 L106 58 Z" fill="#0079d1"/>` +
            `</g>` +
            `</svg>`
        );
    }

    function renderRowingConditions(current) {
        const scene = el('kriWeatherRowingScene');
        const paceEl = el('kriWeatherRowingPace');
        const windEl = el('kriWeatherRowingWind');
        if (!scene || !paceEl || !windEl) return;

        if (!current) {
            scene.innerHTML = '';
            paceEl.textContent = '—';
            windEl.textContent = '—';
            return;
        }

        const speed = current.wind_speed_10m;
        const windFrom = current.wind_direction_10m;
        const courseBearing = getCourseBearing();
        const rel = windRelativeToBoat(relativeWindDeg(windFrom, courseBearing));
        const isTailwind = rel.type === 'tail';

        scene.innerHTML = rowingScullSvg(courseBearing, windFrom);
        paceEl.textContent = rowingPaceLabel(speed, isTailwind);
        windEl.textContent = rel.label;
    }

    function windSpeedToColor(speedKmh) {
        const span = WIND_SPEED_MAX_KMH - WIND_SPEED_MIN_KMH;
        const s =
            typeof speedKmh === 'number' && !Number.isNaN(speedKmh)
                ? speedKmh
                : WIND_SPEED_MIN_KMH;
        const t = Math.min(1, Math.max(0, (s - WIND_SPEED_MIN_KMH) / span));
        const r = Math.round(WIND_COLOR_LOW.r + t * (WIND_COLOR_HIGH.r - WIND_COLOR_LOW.r));
        const g = Math.round(WIND_COLOR_LOW.g + t * (WIND_COLOR_HIGH.g - WIND_COLOR_LOW.g));
        const b = Math.round(WIND_COLOR_LOW.b + t * (WIND_COLOR_HIGH.b - WIND_COLOR_LOW.b));
        return `rgb(${r}, ${g}, ${b})`;
    }

    /**
     * Open-Meteo wind_direction_10m = degrees wind is coming FROM (0° = north).
     * Arrow glyph points east by default; rotate to where wind blows TO on the map.
     */
    function windDirectionToArrowRotate(dirFromDeg) {
        const from = Number(dirFromDeg);
        if (!Number.isFinite(from)) return 0;
        return ((from + 90) % 360 + 360) % 360;
    }

    function windArrowHtml(speedKmh, dirFromDeg) {
        const color = windSpeedToColor(speedKmh);
        const len = Math.min(
            52 * WIND_ARROW_SCALE,
            Math.max(16 * WIND_ARROW_SCALE, speedKmh * 2.8 * WIND_ARROW_SCALE),
        );
        const shaftW = Math.max(8 * WIND_ARROW_SCALE, len - 10 * WIND_ARROW_SCALE);
        const rotateDeg = windDirectionToArrowRotate(dirFromDeg);
        const cycleSec = Math.max(10, Math.min(18, 16 - speedKmh * 0.08));
        const delaySec = (Math.random() * cycleSec).toFixed(2);
        const travelMax = Math.round(10 + speedKmh * 0.35);
        const travelMin = Math.round(-travelMax * 0.35);
        return (
            `<div class="kri-wind-arrow" style="transform: rotate(${rotateDeg}deg); width:${len}px;--wind-cycle:${cycleSec}s;--wind-delay:${delaySec}s;--wind-peak:${WIND_ARROW_OPACITY};--wind-travel-min:${travelMin}px;--wind-travel-max:${travelMax}px">` +
            `<div class="kri-wind-arrow__track">` +
            `<span class="kri-wind-arrow__shaft" style="width:${shaftW}px;background:${color}"></span>` +
            `<span class="kri-wind-arrow__head" style="border-left-color:${color}"></span>` +
            `</div></div>`
        );
    }

    function windIcon(speedKmh, dirFromDeg) {
        const w = 56 * WIND_ARROW_SCALE;
        const h = 16 * WIND_ARROW_SCALE;
        return L.divIcon({
            className: 'kri-wind-arrow-wrap',
            html: windArrowHtml(speedKmh, dirFromDeg),
            iconSize: [w, h],
            iconAnchor: [w / 2, h / 2],
        });
    }

    function windSpeedIcon(speedKmh) {
        const speed = Math.round(speedKmh);
        return L.divIcon({
            className: 'kri-weather-wind-speed-wrap',
            html:
                `<div class="kri-weather-wind-speed-label">` +
                `<span class="kri-weather-wind-speed-value">${speed}</span>` +
                `<span class="kri-weather-wind-speed-unit">km/h</span>` +
                `</div>`,
            iconSize: [54, 34],
            iconAnchor: [27, 17],
        });
    }

    function nearestGridSample(gridData, lat, lon) {
        if (!gridData?.length) return null;
        let best = null;
        let bestD = Infinity;
        for (const pt of gridData) {
            const d = (pt.lat - lat) ** 2 + (pt.lon - lon) ** 2;
            if (d < bestD) {
                bestD = d;
                best = pt;
            }
        }
        return best?.data?.current || null;
    }

    function getWindBounds() {
        if (global.KriRowingCourseOverlay) {
            const { start, finish } = global.KriRowingCourseOverlay.loadStartFinish();
            return {
                south: Math.min(start.lat, finish.lat) - COURSE_BOUNDS_MARGIN,
                north: Math.max(start.lat, finish.lat) + COURSE_BOUNDS_MARGIN,
                west: Math.min(start.lng, finish.lng) - COURSE_BOUNDS_MARGIN,
                east: Math.max(start.lng, finish.lng) + COURSE_BOUNDS_MARGIN,
            };
        }
        const [[south, west], [north, east]] = LAKE.bounds;
        return { south, north, west, east };
    }

    function siteDistSq(a, b, lonScale) {
        const dLat = a.lat - b.lat;
        const dLon = (a.lon - b.lon) * lonScale;
        return dLat * dLat + dLon * dLon;
    }

    /** Jittered, minimum-spacing placement — even coverage without visible rows. */
    function initScatteredWindSites() {
        const b = getWindBounds();
        const count = WIND_SITE_COUNT;
        const latSpan = b.north - b.south;
        const lonSpan = b.east - b.west;
        const lonScale = latSpan / Math.max(lonSpan, 1e-9);
        const area = latSpan * lonSpan;
        const minDist = Math.sqrt(area / (count * 1.15)) * 0.9;
        const minDistSq = minDist * minDist;

        const aspect = lonSpan / Math.max(latSpan, 1e-9);
        const cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
        const rows = Math.max(1, Math.ceil(count / cols));
        const cellLat = latSpan / rows;
        const cellLon = lonSpan / cols;

        const candidates = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const jLat = (Math.random() - 0.5) * 0.88 * cellLat;
                const jLon = (Math.random() - 0.5) * 0.88 * cellLon;
                candidates.push({
                    lat: b.south + (r + 0.5) * cellLat + jLat,
                    lon: b.west + (c + 0.5) * cellLon + jLon,
                });
            }
        }
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = candidates[i];
            candidates[i] = candidates[j];
            candidates[j] = tmp;
        }

        randomWindSites = [];
        for (const cand of candidates) {
            if (randomWindSites.length >= count) break;
            let ok = true;
            for (const s of randomWindSites) {
                if (siteDistSq(cand, s, lonScale) < minDistSq) {
                    ok = false;
                    break;
                }
            }
            if (ok) randomWindSites.push(cand);
        }

        let attempts = 0;
        const maxAttempts = count * 100;
        while (randomWindSites.length < count && attempts < maxAttempts) {
            attempts += 1;
            const cand = {
                lat: b.south + Math.random() * latSpan,
                lon: b.west + Math.random() * lonSpan,
            };
            let ok = true;
            for (const s of randomWindSites) {
                if (siteDistSq(cand, s, lonScale) < minDistSq) {
                    ok = false;
                    break;
                }
            }
            if (ok) randomWindSites.push(cand);
        }
    }

    function maxPrecipMm(gridData, centerCurrent) {
        let max = centerCurrent?.precipitation ?? 0;
        for (const pt of gridData) {
            const p = pt.data?.current?.precipitation ?? 0;
            if (p > max) max = p;
        }
        return max;
    }

    function isRainyWeatherCode(code) {
        const w = Number(code);
        if (!Number.isFinite(w)) return false;
        return (w >= 51 && w <= 67) || (w >= 80 && w <= 82) || w >= 95;
    }

    function rainFxIntensity(gridData, centerCurrent) {
        const maxMm = maxPrecipMm(gridData, centerCurrent);
        if (maxMm > 0.01) {
            return { show: true, intensity: Math.min(1, Math.max(0.35, maxMm / 1.8)) };
        }
        const samples = [centerCurrent, ...gridData.map((pt) => pt.data?.current)].filter(Boolean);
        if (samples.some((c) => isRainyWeatherCode(c.weather_code))) {
            return { show: true, intensity: 0.4 };
        }
        return { show: false, intensity: 0 };
    }

    function createRainCluster(intensity) {
        const cluster = document.createElement('div');
        cluster.className = 'kri-weather-rain-cluster';
        cluster.style.left = `${2 + Math.random() * 90}%`;
        cluster.style.top = `${2 + Math.random() * 90}%`;
        cluster.style.setProperty('--drift-x', `${30 + Math.random() * 55}px`);
        cluster.style.setProperty('--drift-y', `${14 + Math.random() * 28}px`);
        cluster.style.setProperty('--drift-duration', `${10 + Math.random() * 10}s`);
        cluster.style.setProperty('--cluster-opacity', String(0.55 + intensity * 0.4));

        const streaks = Math.round(6 + intensity * 22);
        for (let i = 0; i < streaks; i++) {
            const streak = document.createElement('span');
            streak.className = 'kri-weather-rain-streak';
            streak.style.left = `${Math.random() * 100}%`;
            streak.style.top = `${Math.random() * 100}%`;
            streak.style.width = `${3 + Math.random() * 2}px`;
            streak.style.height = `${16 + Math.random() * 20}px`;
            streak.style.setProperty('--pulse-duration', `${0.7 + Math.random() * 1}s`);
            streak.style.setProperty('--streak-opacity', String(0.55 + intensity * 0.4));
            streak.style.animationDelay = `${Math.random() * 1.8}s`;
            cluster.appendChild(streak);
        }
        return cluster;
    }

    function renderRainFx(gridData, centerCurrent) {
        const fx = el('kriWeatherRainFx');
        if (!fx) return;
        fx.replaceChildren('');
        const { show, intensity } = rainFxIntensity(gridData, centerCurrent);
        if (!show) return;
        const clusterCount = Math.round(5 + intensity * 14);
        for (let c = 0; c < clusterCount; c++) {
            fx.appendChild(createRainCluster(intensity * (0.88 + Math.random() * 0.24)));
        }
    }

    function clearMapLayers() {
        if (windLayer) windLayer.clearLayers();
        if (windLabelLayer) windLabelLayer.clearLayers();
        if (decorativeWindLayer) decorativeWindLayer.clearLayers();
    }

    function renderDecorativeWind(gridData, fallbackCurrent) {
        if (!decorativeWindLayer || !randomWindSites.length) return;
        for (const site of randomWindSites) {
            const cur = nearestGridSample(gridData, site.lat, site.lon) || fallbackCurrent;
            if (!cur) continue;
            const speed = cur.wind_speed_10m * (0.88 + Math.random() * 0.22);
            const dir = cur.wind_direction_10m;
            decorativeWindLayer.addLayer(
                L.marker([site.lat, site.lon], {
                    icon: windIcon(speed, dir),
                    interactive: false,
                }),
            );
        }
    }

    function renderMapOverlays(gridData, centerCurrent) {
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

            windLabelLayer.addLayer(
                L.marker([pt.lat + 0.0018, pt.lon], {
                    icon: windSpeedIcon(cur.wind_speed_10m),
                    interactive: false,
                }),
            );

        }

        renderDecorativeWind(gridData, centerCurrent);
        renderRainFx(gridData, centerCurrent);
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
            renderRowingConditions(centerData.current);
            renderForecast(centerData.hourly);
            renderForecastCharts(centerData.hourly);
            renderMapOverlays(gridResults, centerData.current);

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
        windLabelLayer = null;
        decorativeWindLayer = null;
        courseLayer = null;
        lockedMapView = null;
        const rainFx = el('kriWeatherRainFx');
        if (rainFx) rainFx.replaceChildren('');
        randomWindSites = [];
    }

    function applyLockedMapView() {
        if (!map || !lockedMapView) return;
        map.setView(lockedMapView.center, lockedMapView.zoom, { animate: false });
    }

    function fitMapToCourse(forceRecalc = false) {
        if (!map) return;
        if (lockedMapView && !forceRecalc) {
            applyLockedMapView();
            return;
        }

        const b = getWindBounds();
        map.fitBounds(
            [
                [b.south, b.west],
                [b.north, b.east],
            ],
            { padding: [24, 24], animate: false },
        );
        const z = map.getZoom();
        if (Number.isFinite(z)) {
            map.setZoom(z + Math.log2(ZOOM_IN_FACTOR), { animate: false });
        }
        lockedMapView = {
            center: map.getCenter(),
            zoom: map.getZoom(),
        };
    }

    function syncMapLayout(forceRecalc = false) {
        if (!map) return;
        map.invalidateSize();
        fitMapToCourse(forceRecalc);
        applyLockedMapView();
    }

    function mountCourseOverlay() {
        if (!map || !global.KriRowingCourseOverlay || courseLayer) return;
        if (!map.getPane('kriCoursePane')) {
            map.createPane('kriCoursePane');
            map.getPane('kriCoursePane').style.zIndex = 420;
        }
        courseLayer = L.layerGroup([], { pane: 'kriCoursePane' }).addTo(map);
        global.KriRowingCourseOverlay.mount(map, courseLayer, { hideLaneLabels: true });
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

        mountCourseOverlay();
        initScatteredWindSites();

        if (!map.getPane('kriWindPane')) {
            map.createPane('kriWindPane');
            map.getPane('kriWindPane').style.zIndex = 450;
        }
        if (!map.getPane('kriWindLabelPane')) {
            map.createPane('kriWindLabelPane');
            map.getPane('kriWindLabelPane').style.zIndex = 465;
        }
        if (!map.getPane('kriDecorativeWindPane')) {
            map.createPane('kriDecorativeWindPane');
            map.getPane('kriDecorativeWindPane').style.zIndex = 448;
        }
        windLayer = L.layerGroup([], { pane: 'kriWindPane' }).addTo(map);
        windLabelLayer = L.layerGroup([], { pane: 'kriWindLabelPane' }).addTo(map);
        decorativeWindLayer = L.layerGroup([], { pane: 'kriDecorativeWindPane' }).addTo(map);

        /* Fit once the container has layout — avoids a visible zoom after intro fade-in. */
        requestAnimationFrame(() => syncMapLayout(true));
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
            '<div class="kri-weather-rain-fx" id="kriWeatherRainFx" aria-hidden="true"></div>' +
            '<div class="kri-weather-vignette" aria-hidden="true"></div>' +
            '<img class="kri-weather-logo" src="assets/kri/kri-logo.png" alt="" width="72" height="72">' +
            '<aside class="kri-weather-panel" aria-live="polite">' +
            '<header class="kri-weather-panel__head">' +
            '<p class="kri-weather-panel__kicker">Lake Karāpiro</p>' +
            '<div class="kri-weather-panel__title-row">' +
            '<h1 class="kri-weather-panel__title">Live weather</h1>' +
            '<div class="kri-weather-condition-icon" id="kriWeatherConditionIcon" aria-hidden="true"></div>' +
            '</div>' +
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
            '<div class="kri-weather-wind-legend" id="kriWeatherWindLegend" aria-hidden="true">' +
            '<span class="kri-weather-wind-legend__title">Wind speed (km/h)</span>' +
            '<div class="kri-weather-wind-legend__bar"></div>' +
            '<div class="kri-weather-wind-legend__labels">' +
            `<span>${WIND_SPEED_MIN_KMH}</span>` +
            `<span>${WIND_SPEED_MAX_KMH}</span>` +
            '</div></div>' +
            '<div class="kri-weather-stack" id="kriWeatherStack" aria-hidden="true">' +
            '<div class="kri-weather-rowing" id="kriWeatherRowing">' +
            '<h3 class="kri-weather-rowing__title">Rowing conditions</h3>' +
            '<div class="kri-weather-rowing__scene" id="kriWeatherRowingScene"></div>' +
            '<p class="kri-weather-rowing__pace" id="kriWeatherRowingPace">—</p>' +
            '<p class="kri-weather-rowing__wind" id="kriWeatherRowingWind">—</p>' +
            '</div>' +
            '<div class="kri-weather-charts" id="kriWeatherCharts">' +
            '<div class="kri-weather-chart" id="kriWeatherChartTemp"></div>' +
            '<div class="kri-weather-chart" id="kriWeatherChartWind"></div>' +
            '<div class="kri-weather-chart" id="kriWeatherChartRain"></div>' +
            '</div></div>' +
            '<p class="kri-weather-legend" id="kriWeatherLegend">' +
            'Wind arrows = direction at 10 m. Map labels = speed (km/h). Colour: blue (light) → red (strong). Rain streaks = rainfall.' +
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

        /* Lock map view before fade-in so course fit is not visible as a late zoom. */
        void panel.offsetWidth;
        syncMapLayout(true);

        panel.classList.remove('vg-kri-weather--outro', 'vg-kri-weather--hold');
        panel.classList.add('vg-kri-weather--intro');
        void panel.offsetWidth;
        panel.classList.add('vg-kri-weather--visible');

        await wait(INTRO_MS);
        panel.classList.remove('vg-kri-weather--intro');
        panel.classList.add('vg-kri-weather--hold');
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
        void panel.offsetWidth;
        syncMapLayout(true);
        panel.classList.add('vg-kri-weather--visible', 'vg-kri-weather--hold');
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
