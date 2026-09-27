(function () {
    const TZ = 'Pacific/Auckland';
    const RECENT_DAYS = 7;
    const statusEl = document.getElementById('hazardsStatus');
    const listEl = document.getElementById('hazardsList');

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

    function formatDayLabel(dateStr) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
        if (!match) return dateStr;
        const y = Number(match[1]);
        const mo = Number(match[2]);
        const d = Number(match[3]);
        const anchor = new Date(Date.UTC(y, mo - 1, d, 12));
        return new Intl.DateTimeFormat('en-NZ', {
            timeZone: 'UTC',
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        }).format(anchor);
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

    function formatDuration(ms) {
        if (ms == null || !Number.isFinite(Number(ms))) return '—';
        const totalMin = Math.max(0, Math.round(Number(ms) / 60000));
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        if (h <= 0) return `${m} min`;
        if (m === 0) return `${h} h`;
        return `${h} h ${m} min`;
    }

    function dateKeyDaysAgo(daysAgo) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date(Date.now() - daysAgo * 86400000));
    }

    function renderEntries(entries) {
        if (!entries?.length) {
            return '<p class="rnz-logbook-status">No hazard entries for this day.</p>';
        }
        const rows = entries
            .map((e) => {
                const exited = e.open
                    ? '<span class="rnz-hazard-open">Still inside</span>'
                    : escapeHtml(formatTime(e.exitedAt));
                return (
                    `<tr>` +
                    `<td class="rnz-hazard-name">${escapeHtml(e.hazardName || 'Hazard')}</td>` +
                    `<td class="rnz-logbook-crew-name">${escapeHtml(e.crew || e.uniqueId)}</td>` +
                    `<td>${escapeHtml(formatTime(e.enteredAt))}</td>` +
                    `<td>${exited}</td>` +
                    `<td>${escapeHtml(formatDuration(e.durationMs))}</td>` +
                    `</tr>`
                );
            })
            .join('');
        return (
            `<table class="rnz-logbook-crew-table">` +
            `<thead><tr>` +
            `<th>Hazard</th><th>Crew</th><th>Entered</th><th>Exited</th><th>Duration</th>` +
            `</tr></thead>` +
            `<tbody>${rows}</tbody>` +
            `</table>`
        );
    }

    function renderDaySummaryStats(day) {
        const openClass = day.openCount > 0 ? ' is-open' : '';
        return (
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Entries</span>` +
            `<span class="rnz-logbook-stat-value">${escapeHtml(String(day.entryCount || 0))}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Open</span>` +
            `<span class="rnz-logbook-stat-value${openClass}">${escapeHtml(String(day.openCount || 0))}</span></span>`
        );
    }

    function renderDayCard(day, options = {}) {
        const nestedClass = options.nested ? ' rnz-logbook-day--nested' : '';
        return (
            `<details class="rnz-logbook-day${nestedClass}">` +
            `<summary class="rnz-logbook-day-summary rnz-hazards-day-summary">` +
            `<span class="rnz-logbook-day-date">${escapeHtml(formatDayLabel(day.date))}</span>` +
            renderDaySummaryStats(day) +
            `</summary>` +
            `<div class="rnz-logbook-day-body">${renderEntries(day.entries)}</div>` +
            `</details>`
        );
    }

    function aggregateDays(days) {
        return days.reduce(
            (acc, day) => ({
                entryCount: acc.entryCount + (day.entryCount || 0),
                openCount: acc.openCount + (day.openCount || 0),
                dayCount: acc.dayCount + 1,
            }),
            { entryCount: 0, openCount: 0, dayCount: 0 },
        );
    }

    function renderOlderBucket(days) {
        const agg = aggregateDays(days);
        const openClass = agg.openCount > 0 ? ' is-open' : '';
        const dayLabel = agg.dayCount === 1 ? '1 day' : `${agg.dayCount} days`;
        return (
            `<details class="rnz-logbook-day rnz-logbook-older-bucket">` +
            `<summary class="rnz-logbook-day-summary rnz-hazards-day-summary">` +
            `<span class="rnz-logbook-day-date">Older than ${RECENT_DAYS} days` +
            `<span class="rnz-logbook-day-sub">${escapeHtml(dayLabel)}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Entries</span>` +
            `<span class="rnz-logbook-stat-value">${escapeHtml(String(agg.entryCount))}</span></span>` +
            `<span class="rnz-logbook-stat"><span class="rnz-logbook-stat-label">Open</span>` +
            `<span class="rnz-logbook-stat-value${openClass}">${escapeHtml(String(agg.openCount))}</span></span>` +
            `</summary>` +
            `<div class="rnz-logbook-older-body">${days.map((day) => renderDayCard(day, { nested: true })).join('')}</div>` +
            `</details>`
        );
    }

    function renderDays(days) {
        if (!days?.length) {
            setStatus('No hazard entries found in the last 45 days.', false);
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

        listEl.innerHTML = [
            ...recent.map((day) => renderDayCard(day)),
            ...(older.length ? [renderOlderBucket(older)] : []),
        ].join('');
    }

    async function fetchHazardDays(days) {
        const res = await fetch(
            '/api/traccar?action=hazards&source=rowing&days=' +
                encodeURIComponent(String(days)) +
                '&tz=' +
                encodeURIComponent(TZ),
            { headers: { Accept: 'application/json' } },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
            throw new Error(data.error || `Failed to load hazards (${res.status})`);
        }
        return Array.isArray(data.days) ? data.days : [];
    }

    async function loadHazards() {
        setStatus('Loading hazard register…', false);
        try {
            renderDays(await fetchHazardDays(45));
        } catch (err) {
            listEl.hidden = true;
            listEl.innerHTML = '';
            setStatus(err instanceof Error ? err.message : String(err), true);
        }
    }

    void loadHazards();
})();
