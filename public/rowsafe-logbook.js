(function () {
    const TZ = 'Pacific/Auckland';
    const RECENT_DAYS = 7;
    const statusEl = document.getElementById('logbookStatus');
    const listEl = document.getElementById('logbookList');

    function setStatus(message, isError) {
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.classList.toggle('is-error', Boolean(isError));
        statusEl.hidden = !message;
    }

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDistance(meters) {
        const m = Number(meters) || 0;
        if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
        return `${Math.round(m)} m`;
    }

    function formatDuration(ms) {
        const totalMin = Math.max(0, Math.round((Number(ms) || 0) / 60000));
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        if (h <= 0) return `${m} min`;
        if (m === 0) return `${h} h`;
        return `${h} h ${m} min`;
    }

    function formatDayLabel(dateStr) {
        const parts = String(dateStr).split('-').map(Number);
        if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateStr;
        const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
        return new Intl.DateTimeFormat('en-NZ', {
            timeZone: TZ,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        }).format(utc);
    }

    function formatTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) return '—';
        return new Intl.DateTimeFormat('en-NZ', {
            timeZone: TZ,
            hour: 'numeric',
            minute: '2-digit',
        }).format(d);
    }

    function dateKeyDaysAgo(daysAgo) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date(Date.now() - daysAgo * 86400000));
    }

    function renderSessions(sessions) {
        if (!sessions?.length) {
            return '<p class="rnz-logbook-status">No crew sessions for this day.</p>';
        }
        const rows = sessions
            .map((s) => {
                const capsize = s.capsize
                    ? '<span class="rnz-logbook-capsize-yes">Yes</span>'
                    : '<span class="rnz-logbook-capsize-no">No</span>';
                return (
                    `<tr>` +
                    `<td class="rnz-logbook-crew-name">${escapeHtml(s.crew || s.uniqueId)}</td>` +
                    `<td>${escapeHtml(formatTime(s.startedAt))}</td>` +
                    `<td>${escapeHtml(formatTime(s.endedAt))}</td>` +
                    `<td>${capsize}</td>` +
                    `<td>${escapeHtml(formatDistance(s.distanceM))}</td>` +
                    `</tr>`
                );
            })
            .join('');
        return (
            `<table class="rnz-logbook-crew-table">` +
            `<thead><tr>` +
            `<th>Crew</th><th>Start</th><th>Finish</th><th>Capsize</th><th>Distance</th>` +
            `</tr></thead>` +
            `<tbody>${rows}</tbody>` +
            `</table>`
        );
    }

    function renderDaySummaryStats(day) {
        const capClass = day.capsizeCount > 0 ? ' is-warn' : '';
        return (
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Crews</span>` +
            `<span class="rnz-logbook-stat-value">${escapeHtml(String(day.sessionCount))}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Capsizes</span>` +
            `<span class="rnz-logbook-stat-value${capClass}">${escapeHtml(String(day.capsizeCount))}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Distance</span>` +
            `<span class="rnz-logbook-stat-value">${escapeHtml(formatDistance(day.distanceM))}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">On water</span>` +
            `<span class="rnz-logbook-stat-value">${escapeHtml(formatDuration(day.onWaterMs))}</span></span>`
        );
    }

    function renderDayCard(day, options = {}) {
        const nestedClass = options.nested ? ' rnz-logbook-day--nested' : '';
        return (
            `<details class="rnz-logbook-day${nestedClass}">` +
            `<summary class="rnz-logbook-day-summary">` +
            `<span class="rnz-logbook-day-date">${escapeHtml(formatDayLabel(day.date))}</span>` +
            renderDaySummaryStats(day) +
            `</summary>` +
            `<div class="rnz-logbook-day-body">${renderSessions(day.sessions)}</div>` +
            `</details>`
        );
    }

    function aggregateDays(days) {
        return days.reduce(
            (acc, day) => ({
                sessionCount: acc.sessionCount + (day.sessionCount || 0),
                capsizeCount: acc.capsizeCount + (day.capsizeCount || 0),
                distanceM: acc.distanceM + (day.distanceM || 0),
                onWaterMs: acc.onWaterMs + (day.onWaterMs || 0),
                dayCount: acc.dayCount + 1,
            }),
            { sessionCount: 0, capsizeCount: 0, distanceM: 0, onWaterMs: 0, dayCount: 0 },
        );
    }

    function renderOlderBucket(days) {
        const agg = aggregateDays(days);
        const capClass = agg.capsizeCount > 0 ? ' is-warn' : '';
        const dayLabel =
            agg.dayCount === 1 ? '1 day' : `${agg.dayCount} days`;
        return (
            `<details class="rnz-logbook-day rnz-logbook-older-bucket">` +
            `<summary class="rnz-logbook-day-summary">` +
            `<span class="rnz-logbook-day-date">Older than ${RECENT_DAYS} days` +
            `<span class="rnz-logbook-day-sub">${escapeHtml(dayLabel)}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Crews</span>` +
            `<span class="rnz-logbook-stat-value">${escapeHtml(String(agg.sessionCount))}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Capsizes</span>` +
            `<span class="rnz-logbook-stat-value${capClass}">${escapeHtml(String(agg.capsizeCount))}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Distance</span>` +
            `<span class="rnz-logbook-stat-value">${escapeHtml(formatDistance(agg.distanceM))}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">On water</span>` +
            `<span class="rnz-logbook-stat-value">${escapeHtml(formatDuration(agg.onWaterMs))}</span></span>` +
            `</summary>` +
            `<div class="rnz-logbook-older-body">${days.map((day) => renderDayCard(day, { nested: true })).join('')}</div>` +
            `</details>`
        );
    }

    function renderDays(days) {
        if (!days?.length) {
            setStatus('No sessions found in the last 45 days.', false);
            listEl.hidden = true;
            listEl.innerHTML = '';
            return;
        }
        setStatus('', false);
        listEl.hidden = false;

        const cutoff = dateKeyDaysAgo(RECENT_DAYS);
        const recent = [];
        const older = [];
        for (const day of days) {
            if (String(day.date) >= cutoff) recent.push(day);
            else older.push(day);
        }

        const html = [
            ...recent.map((day) => renderDayCard(day)),
            ...(older.length ? [renderOlderBucket(older)] : []),
        ].join('');
        listEl.innerHTML = html;
    }

    async function loadLogbook() {
        setStatus('Loading logbook…', false);
        try {
            const res = await fetch(
                '/api/traccar?action=logbook&source=rowing&days=45&tz=' + encodeURIComponent(TZ),
                { headers: { Accept: 'application/json' } },
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) {
                throw new Error(data.error || `Failed to load logbook (${res.status})`);
            }
            renderDays(Array.isArray(data.days) ? data.days : []);
        } catch (err) {
            listEl.hidden = true;
            listEl.innerHTML = '';
            setStatus(err instanceof Error ? err.message : String(err), true);
        }
    }

    void loadLogbook();
})();
