/**
 * Altitude HD documents — archived reports + live storage / battery charts.
 */
(function () {
    const RECORDER_BASE =
        window.DOC_RECORDER_BASE || 'https://rowing-app-recorder-pwa.vercel.app';
    const LS_TOKEN = 'rnz_dashboard_token';
    const REPORTS_URL = 'data/documents-reports.json';

    const charts = {};
    const maps = {};

    function $(id) {
        return document.getElementById(id);
    }

    function getToken() {
        const input = $('docIngestToken');
        const v = input?.value?.trim() || localStorage.getItem(LS_TOKEN) || '';
        if (input && v) input.value = v;
        return v;
    }

    function apiHeaders() {
        const h = { Accept: 'application/json' };
        const token = getToken();
        if (token) h.Authorization = `Bearer ${token}`;
        return h;
    }

    function setStatus(text, ok = true) {
        const el = $('docStatus');
        if (!el) return;
        el.textContent = text;
        el.dataset.ok = ok ? '1' : '0';
    }

    function fmtBytes(n) {
        if (n == null || !Number.isFinite(n)) return '—';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
        return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function fmtDate(isoOrMs) {
        if (isoOrMs == null) return '—';
        try {
            const d =
                typeof isoOrMs === 'number'
                    ? new Date(isoOrMs)
                    : new Date(isoOrMs);
            return d.toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
            });
        } catch {
            return String(isoOrMs);
        }
    }

    async function fetchRecorder(path) {
        const res = await fetch(`${RECORDER_BASE}${path}`, { headers: apiHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data.error || `HTTP ${res.status}`;
            throw new Error(msg);
        }
        return data;
    }

    function destroyChart(id) {
        if (charts[id]) {
            charts[id].destroy();
            delete charts[id];
        }
    }

    function chartColors(n, palette) {
        const base = palette || ['#00e5ff', '#f59e0b', '#4ade80', '#f472b6', '#a78bfa'];
        return Array.from({ length: n }, (_, i) => base[i % base.length]);
    }

    function makeBarChart(canvasId, title, labels, values, unit, colors) {
        destroyChart(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return null;

        const id = canvasId;
        charts[id] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: unit || '',
                        data: values,
                        backgroundColor: chartColors(values.length, colors),
                        borderRadius: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: !!title, text: title, color: '#94a3b8', font: { size: 12 } },
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148,163,184,0.12)' },
                    },
                    y: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148,163,184,0.12)' },
                        beginAtZero: true,
                    },
                },
            },
        });
        return charts[id];
    }

    function makeGroupedBarChart(canvas, title, labels, datasets) {
        const canvasId = canvas.id;
        destroyChart(canvasId);
        if (typeof Chart === 'undefined') return null;

        charts[canvasId] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: datasets.map((ds, i) => ({
                    label: ds.label,
                    data: ds.values,
                    backgroundColor: chartColors(1, [
                        ['#f59e0b', '#3b82f6', '#4ade80', '#f472b6'][i % 4],
                    ])[0],
                    borderRadius: 4,
                })),
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#94a3b8', boxWidth: 12 },
                    },
                    title: { display: !!title, text: title, color: '#94a3b8', font: { size: 12 } },
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148,163,184,0.12)' },
                    },
                    y: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148,163,184,0.12)' },
                        beginAtZero: true,
                    },
                },
            },
        });
        return charts[canvasId];
    }

    function destroyMap(id) {
        if (maps[id]) {
            maps[id].remove();
            delete maps[id];
        }
    }

    function pinIcon(color, label) {
        return L.divIcon({
            className: 'doc-map-pin',
            html: `<span style="background:${color}" title="${escapeHtml(label)}"></span>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
        });
    }

    function renderReportMapShell(container, mapDef, reportId) {
        const wrap = document.createElement('div');
        wrap.className = 'doc-report-map-wrap doc-card';
        const height = mapDef.height || 420;
        wrap.innerHTML = `
            <h2>Session GPS overlay</h2>
            <p class="doc-report-map-caption" id="map-caption-${reportId}">Loading track data…</p>
            <div class="doc-report-map" id="map-${reportId}" style="height:${height}px" role="img" aria-label="GPS track overlay"></div>
            <div class="doc-report-map-legend" id="map-legend-${reportId}" hidden></div>
            <p class="doc-report-map-status" id="map-status-${reportId}">Loading…</p>
        `;
        container.appendChild(wrap);
    }

    async function mountReportMap(reportId, tracksUrl) {
        const mapEl = $(`map-${reportId}`);
        const legendEl = $(`map-legend-${reportId}`);
        const captionEl = $(`map-caption-${reportId}`);
        const statusEl = $(`map-status-${reportId}`);
        if (!mapEl || typeof L === 'undefined') return;

        destroyMap(reportId);

        const setMapStatus = (text, ok = true) => {
            if (statusEl) {
                statusEl.textContent = text;
                statusEl.dataset.ok = ok ? '1' : '0';
            }
        };

        try {
            const res = await fetch(tracksUrl);
            if (!res.ok) throw new Error(`Could not load ${tracksUrl}`);
            const data = await res.json();

            const session = data.session || {};
            if (captionEl) {
                captionEl.textContent =
                    session.label ||
                    `${session.recorderDevice || 'Recorder'} vs ${session.traccarDevice || 'Traccar'}`;
            }

            const map = L.map(mapEl, { zoomControl: true, attributionControl: true });
            maps[reportId] = map;

            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
                attribution:
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            }).addTo(map);

            const bounds = [];
            const legendItems = [];

            const trackOrder = ['recorder', 'traccar'];
            for (const key of trackOrder) {
                const track = data.tracks?.[key];
                if (!track?.points?.length) continue;

                const latlngs = track.points.map((p) => {
                    bounds.push(p);
                    return [p[0], p[1]];
                });

                const isTraccar = key === 'traccar';
                L.polyline(latlngs, {
                    color: track.color || (isTraccar ? '#f59e0b' : '#00e5ff'),
                    weight: isTraccar ? 3 : 5,
                    opacity: isTraccar ? 0.92 : 0.78,
                    dashArray: isTraccar ? '8 6' : null,
                }).addTo(map);

                legendItems.push({
                    label: track.label || key,
                    color: track.color || (isTraccar ? '#f59e0b' : '#00e5ff'),
                    dashed: isTraccar,
                    count: track.count,
                });
            }

            const pins = data.pins || {};
            if (pins.start) {
                const { lat, lng, name } = pins.start;
                bounds.push([lat, lng]);
                L.marker([lat, lng], { icon: pinIcon('#4ade80', name || 'Start') })
                    .bindPopup(escapeHtml(name || 'Start pin'))
                    .addTo(map);
                legendItems.push({ label: pins.start.name || 'Start pin', color: '#4ade80', pin: true });
            }
            if (pins.finish) {
                const { lat, lng, name } = pins.finish;
                bounds.push([lat, lng]);
                L.marker([lat, lng], { icon: pinIcon('#f87171', name || 'Finish') })
                    .bindPopup(escapeHtml(name || 'Finish pin'))
                    .addTo(map);
                legendItems.push({ label: pins.finish.name || 'Finish pin', color: '#f87171', pin: true });
            }

            if (legendEl && legendItems.length) {
                legendEl.hidden = false;
                legendEl.innerHTML = legendItems
                    .map((item) => {
                        const count =
                            item.count != null
                                ? ` · ${Number(item.count).toLocaleString()} pts`
                                : '';
                        const swatchClass = item.dashed
                            ? ' doc-map-swatch--dashed'
                            : item.pin
                              ? ''
                              : '';
                        const swatchStyle = item.pin
                            ? `border-radius:50%;width:10px;height:10px;background:${item.color}`
                            : `background:${item.color}`;
                        return `<span><i class="${swatchClass.trim()}" style="${swatchStyle}"></i>${escapeHtml(item.label)}${escapeHtml(count)}</span>`;
                    })
                    .join('');
            }

            if (bounds.length) {
                map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
            } else {
                map.setView([-37.95, 175.55], 12);
            }

            requestAnimationFrame(() => map.invalidateSize());

            const counts = trackOrder
                .map((k) => data.tracks?.[k]?.count)
                .filter((n) => n != null);
            const ptsNote =
                counts.length === 2
                    ? `${counts[0].toLocaleString()} vs ${counts[1].toLocaleString()} full-resolution points (map shows ~450 each).`
                    : '';
            setMapStatus(
                ptsNote ? `Tracks loaded. ${ptsNote}` : 'Tracks loaded.',
                true,
            );
        } catch (e) {
            if (captionEl) captionEl.textContent = 'Could not load GPS tracks.';
            setMapStatus(e.message, false);
        }
    }

    async function mountAllReportMaps(reports) {
        const tasks = (reports || [])
            .filter((r) => r.map?.tracksUrl)
            .map((r) => mountReportMap(r.id, r.map.tracksUrl));
        await Promise.all(tasks);
    }

    function renderReportChart(container, chartDef, reportId) {
        const wrap = document.createElement('div');
        wrap.className = 'doc-card';
        const title = document.createElement('h2');
        title.textContent = chartDef.title || 'Chart';
        wrap.appendChild(title);

        const box = document.createElement('div');
        box.className = 'doc-chart-box';
        const canvas = document.createElement('canvas');
        const canvasId = `report-${reportId}-${chartDef.id}`;
        canvas.id = canvasId;
        canvas.setAttribute('aria-label', chartDef.title || 'Chart');
        box.appendChild(canvas);
        wrap.appendChild(box);
        container.appendChild(wrap);

        requestAnimationFrame(() => {
            if (chartDef.datasets && chartDef.labels) {
                makeGroupedBarChart(canvas, null, chartDef.labels, chartDef.datasets);
            } else if (chartDef.labels && chartDef.values) {
                makeBarChart(
                    canvasId,
                    null,
                    chartDef.labels,
                    chartDef.values,
                    chartDef.unit,
                    chartDef.color,
                );
            }
        });
    }

    function categoryClass(cat) {
        return `doc-report-cat doc-report-cat--${cat || 'data'}`;
    }

    function renderReport(report) {
        const article = document.createElement('article');
        article.className = 'doc-report';
        article.dataset.category = report.category || 'data';
        article.dataset.reportId = report.id;

        const metricsHtml = (report.metrics || [])
            .map(
                (m) =>
                    `<div><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong></div>`,
            )
            .join('');

        const notesHtml = (report.notes || [])
            .map((n) => `<li>${escapeHtml(n)}</li>`)
            .join('');

        article.innerHTML = `
            <div class="doc-report-head">
                <span class="${categoryClass(report.category)}">${escapeHtml(report.category || 'report')}</span>
                <h3>${escapeHtml(report.title)}</h3>
                <span class="doc-report-date">${escapeHtml(report.date || '')}</span>
            </div>
            <p class="doc-report-summary">${escapeHtml(report.summary || '')}</p>
            ${metricsHtml ? `<div class="doc-report-metrics">${metricsHtml}</div>` : ''}
        `;

        const chartsWrap = document.createElement('div');
        chartsWrap.className = 'doc-report-charts';

        if (report.map?.tracksUrl) {
            renderReportMapShell(article, report.map, report.id);
        }

        article.appendChild(chartsWrap);

        if (notesHtml) {
            const ul = document.createElement('ul');
            ul.className = 'doc-report-notes';
            ul.innerHTML = notesHtml;
            article.appendChild(ul);
        }

        if ((report.charts || []).length === 0) {
            chartsWrap.remove();
        } else {
            for (const ch of report.charts) {
                renderReportChart(chartsWrap, ch, report.id);
            }
        }

        return article;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    let activeFilter = 'all';

    function applyFilter() {
        const live = $('docLiveSection');
        const reports = document.querySelectorAll('.doc-report');
        let visible = 0;

        if (live) {
            const showLive =
                activeFilter === 'all' ||
                activeFilter === 'live' ||
                activeFilter === 'storage' ||
                activeFilter === 'data';
            live.hidden = !showLive;
        }

        reports.forEach((el) => {
            const cat = el.dataset.category;
            const show = activeFilter === 'all' || activeFilter === cat;
            el.dataset.hidden = show ? 'false' : 'true';
            if (show) visible++;
        });

        const empty = $('docReportsEmpty');
        if (empty) {
            empty.hidden =
                visible > 0 ||
                activeFilter === 'live' ||
                activeFilter === 'storage' ||
                activeFilter === 'data';
        }

        Object.values(maps).forEach((map) => {
            requestAnimationFrame(() => map.invalidateSize());
        });
    }

    function wireTabs() {
        document.querySelectorAll('.doc-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.doc-tab').forEach((b) => b.classList.remove('doc-tab--active'));
                btn.classList.add('doc-tab--active');
                activeFilter = btn.getAttribute('data-filter') || 'all';
                applyFilter();
            });
        });
    }

    async function loadArchivedReports() {
        const res = await fetch(REPORTS_URL);
        if (!res.ok) throw new Error(`Could not load ${REPORTS_URL}`);
        const data = await res.json();
        const list = $('docReportsList');
        if (!list) return data;
        list.innerHTML = '';
        for (const report of data.reports || []) {
            list.appendChild(renderReport(report));
        }
        await mountAllReportMaps(data.reports || []);
        return data;
    }

    function renderStorage(stats) {
        const body = $('docStorageBody');
        if (!body) return;

        const used = stats.usedBytes;
        const limit = stats.storageLimitBytes;
        const pct = stats.storageUsedPct != null ? Math.min(100, stats.storageUsedPct) : null;
        let fillClass = '';
        if (pct != null) {
            if (pct >= 90) fillClass = ' doc-storage-bar__fill--danger';
            else if (pct >= 75) fillClass = ' doc-storage-bar__fill--warn';
        }

        body.innerHTML = `
            <div class="doc-storage-bar" role="img" aria-label="Storage ${pct != null ? pct + '% used' : 'unknown'}">
                <span class="doc-storage-bar__fill${fillClass}" style="width:${pct != null ? pct : 0}%"></span>
            </div>
            <dl class="doc-stat-grid">
                <div><dt>Used</dt><dd>${fmtBytes(used)}</dd></div>
                <div><dt>Limit</dt><dd>${limit != null ? fmtBytes(limit) : '—'}</dd></div>
                <div><dt>Used %</dt><dd>${pct != null ? pct + '%' : '—'}</dd></div>
                <div><dt>Samples table</dt><dd>${fmtBytes(stats.samplesTableBytes)}</dd></div>
                <div><dt>Total samples</dt><dd>${(stats.sampleCount ?? 0).toLocaleString()}</dd></div>
                <div><dt>Devices</dt><dd>${stats.deviceCount ?? '—'}</dd></div>
                <div><dt>Sessions</dt><dd>${stats.sessionCount ?? '—'}</dd></div>
                <div><dt>Oldest sample</dt><dd>${stats.oldestSampleMs ? fmtDate(stats.oldestSampleMs) : '—'}</dd></div>
                <div><dt>Newest sample</dt><dd>${stats.newestSampleMs ? fmtDate(stats.newestSampleMs) : '—'}</dd></div>
            </dl>
        `;
    }

    async function refreshLive() {
        setStatus('Loading live data…', true);
        let ok = true;
        let msg = '';

        try {
            const ping = await fetchRecorder('/api/ping');
            if (!ping.persisted) {
                msg = 'Recorder has no Postgres — storage panel empty.';
            }
        } catch (e) {
            ok = false;
            msg = `Ping failed: ${e.message}`;
        }

        try {
            const storage = await fetchRecorder('/api/history?storage=stats');
            if (storage.stats) renderStorage(storage.stats);
            else $('docStorageBody').innerHTML = '<p class="doc-status">No storage stats.</p>';
        } catch (e) {
            ok = false;
            $('docStorageBody').innerHTML = `<p class="doc-status" data-ok="0">${escapeHtml(e.message)}</p>`;
        }

        try {
            const dev = await fetchRecorder('/api/devices?onlineSec=600&windowSec=300');
            const devices = (dev.devices || []).filter((d) => d.deviceId && !/^PERF|VERIFY/i.test(d.deviceId));

            const batLabels = [];
            const batValues = [];
            const ingestLabels = [];
            const ingestValues = [];

            for (const d of devices) {
                if (d.battery?.pct != null) {
                    batLabels.push(d.deviceId);
                    batValues.push(d.battery.pct);
                }
                ingestLabels.push(d.deviceId);
                ingestValues.push(d.ingestRateHz ?? 0);
            }

            makeBarChart(
                'docBatteryLiveChart',
                null,
                batLabels.length ? batLabels : ['—'],
                batValues.length ? batValues : [0],
                '%',
                ['#f59e0b', '#3b82f6', '#4ade80', '#00e5ff'],
            );

            const note = $('docBatteryLiveNote');
            if (note && dev.health) {
                note.textContent = `Fleet avg ${dev.health.avgBatteryPct ?? '—'}% · min ${dev.health.minBatteryPct ?? '—'}% · ingest ${dev.health.avgIngestHz ?? '—'} Hz`;
            }

            makeBarChart(
                'docIngestChart',
                null,
                ingestLabels.length ? ingestLabels : ['—'],
                ingestValues,
                'Hz',
            );
        } catch (e) {
            ok = false;
            if (!msg) msg = `Devices: ${e.message}`;
        }

        try {
            const list = await fetchRecorder('/api/history?list=devices');
            const devices = (list.devices || [])
                .filter((d) => d.uniqueId && !/^PERF|VERIFY/i.test(d.uniqueId))
                .sort((a, b) => (b.sampleCount || 0) - (a.sampleCount || 0))
                .slice(0, 12);

            const labels = devices.map((d) => d.uniqueId);
            const counts = devices.map((d) => d.sampleCount || 0);

            destroyChart('docSamplesChart');
            const canvas = $('docSamplesChart');
            if (canvas && typeof Chart !== 'undefined') {
                charts.docSamplesChart = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'Samples',
                                data: counts,
                                backgroundColor: 'rgba(0, 229, 255, 0.45)',
                                borderRadius: 4,
                            },
                        ],
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: {
                                ticks: { color: '#94a3b8' },
                                grid: { color: 'rgba(148,163,184,0.12)' },
                            },
                            y: {
                                ticks: { color: '#94a3b8' },
                                grid: { display: false },
                            },
                        },
                    },
                });
            }
        } catch (e) {
            ok = false;
            if (!msg) msg = `Device list: ${e.message}`;
        }

        const token = getToken();
        if (token) localStorage.setItem(LS_TOKEN, token);

        setStatus(
            ok
                ? `Live data updated ${new Date().toLocaleTimeString()}.`
                : msg || 'Some live panels failed.',
            ok,
        );
    }

    function wireToolbar() {
        $('docRefreshLive')?.addEventListener('click', () => refreshLive());
        $('docIngestToken')?.addEventListener('change', () => {
            const t = getToken();
            if (t) localStorage.setItem(LS_TOKEN, t);
        });
    }

    async function init() {
        wireTabs();
        wireToolbar();

        const saved = localStorage.getItem(LS_TOKEN);
        if (saved && $('docIngestToken')) $('docIngestToken').value = saved;

        try {
            await loadArchivedReports();
            applyFilter();
            setStatus('Reports loaded. Refresh live data for current storage and battery.', true);
        } catch (e) {
            setStatus(`Reports: ${e.message}`, false);
        }

        await refreshLive();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
