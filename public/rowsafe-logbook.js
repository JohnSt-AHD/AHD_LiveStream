(function () {
    const TZ = 'Pacific/Auckland';
    const RECENT_DAYS = 7;
    const statusEl = document.getElementById('logbookStatus');
    const listEl = document.getElementById('logbookList');
    const pdfBtn = document.getElementById('logbookPdfBtn');

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
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
        if (!match) return dateStr;
        const y = Number(match[1]);
        const mo = Number(match[2]);
        const d = Number(match[3]);
        // dateStr is already an Auckland calendar day from the API — format in UTC
        // so noon UTC on that date stays on the same civil day (Pacific/Auckland +12/+13
        // would roll UTC noon forward to the next local day).
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

    function dateKeyDaysAgo(daysAgo) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date(Date.now() - daysAgo * 86400000));
    }

    function previousCalendarMonthRange() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date());
        const y = Number(parts.find((p) => p.type === 'year')?.value);
        const m = Number(parts.find((p) => p.type === 'month')?.value);
        let py = y;
        let pm = m - 1;
        if (pm < 1) {
            pm = 12;
            py = y - 1;
        }
        const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
        const start = `${py}-${String(pm).padStart(2, '0')}-01`;
        const end = `${py}-${String(pm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const monthLabel = new Intl.DateTimeFormat('en-NZ', {
            timeZone: 'UTC',
            month: 'long',
            year: 'numeric',
        }).format(new Date(Date.UTC(py, pm - 1, 15)));
        return { start, end, year: py, month: pm, monthLabel, lastDay };
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

    async function fetchLogbookDays(days) {
        const res = await fetch(
            '/api/traccar?action=logbook&source=rowing&days=' +
                encodeURIComponent(String(days)) +
                '&tz=' +
                encodeURIComponent(TZ),
            { headers: { Accept: 'application/json' } },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
            throw new Error(data.error || `Failed to load logbook (${res.status})`);
        }
        return Array.isArray(data.days) ? data.days : [];
    }

    function buildPdfDocumentHtml(range, days) {
        const agg = aggregateDays(days);
        const fileTitle = `RowSafe-Logbook-${range.year}-${String(range.month).padStart(2, '0')}`;
        const dayBlocks = days.length
            ? days
                  .map((day) => {
                      const sessionRows = (day.sessions || [])
                          .map(
                              (s) =>
                                  `<tr>` +
                                  `<td>${escapeHtml(s.crew || s.uniqueId || '—')}</td>` +
                                  `<td>${escapeHtml(formatTime(s.startedAt))}</td>` +
                                  `<td>${escapeHtml(formatTime(s.endedAt))}</td>` +
                                  `<td>${s.capsize ? 'Yes' : 'No'}</td>` +
                                  `<td>${escapeHtml(formatDistance(s.distanceM))}</td>` +
                                  `</tr>`,
                          )
                          .join('');
                      return (
                          `<section class="day">` +
                          `<h2>${escapeHtml(formatDayLabel(day.date))}</h2>` +
                          `<p class="day-meta">` +
                          `${escapeHtml(String(day.sessionCount))} crews · ` +
                          `${escapeHtml(String(day.capsizeCount))} capsizes · ` +
                          `${escapeHtml(formatDistance(day.distanceM))} · ` +
                          `${escapeHtml(formatDuration(day.onWaterMs))} on water` +
                          `</p>` +
                          (sessionRows
                              ? `<table><thead><tr>` +
                                `<th>Crew</th><th>Start</th><th>Finish</th><th>Capsize</th><th>Distance</th>` +
                                `</tr></thead><tbody>${sessionRows}</tbody></table>`
                              : `<p class="empty">No crew sessions.</p>`) +
                          `</section>`
                      );
                  })
                  .join('')
            : `<p class="empty">No sessions recorded for ${escapeHtml(range.monthLabel)}.</p>`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(fileTitle)}</title>
<style>
  @page { margin: 16mm 14mm; }
  body {
    font-family: "Segoe UI", system-ui, sans-serif;
    color: #0f172a;
    font-size: 11pt;
    line-height: 1.35;
    margin: 0;
  }
  h1 { font-size: 18pt; margin: 0 0 4px; }
  .sub { color: #475569; margin: 0 0 14px; font-size: 10pt; }
  .summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 0 0 18px;
    padding: 10px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: #f8fafc;
  }
  .summary div strong { display: block; font-size: 12pt; }
  .summary div span { color: #64748b; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .day { break-inside: avoid; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
  .day h2 { font-size: 12pt; margin: 0 0 4px; }
  .day-meta { margin: 0 0 8px; color: #475569; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
  th { color: #64748b; font-weight: 650; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.03em; }
  .empty { color: #64748b; }
  .hint { margin-top: 18px; color: #94a3b8; font-size: 9pt; }
  @media print {
    .hint { display: none; }
  }
</style>
</head>
<body>
  <h1>RowSafe logbook</h1>
  <p class="sub">${escapeHtml(range.monthLabel)} · Pacific/Auckland · CrewSight sessions</p>
  <div class="summary">
    <div><span>Crew outings</span><strong>${escapeHtml(String(agg.sessionCount))}</strong></div>
    <div><span>Capsizes</span><strong>${escapeHtml(String(agg.capsizeCount))}</strong></div>
    <div><span>Distance</span><strong>${escapeHtml(formatDistance(agg.distanceM))}</strong></div>
    <div><span>On water</span><strong>${escapeHtml(formatDuration(agg.onWaterMs))}</strong></div>
  </div>
  ${dayBlocks}
  <p class="hint">In the print dialog, choose <strong>Save as PDF</strong> / <strong>Microsoft Print to PDF</strong>.</p>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.focus(); window.print(); }, 200);
    });
  <\/script>
</body>
</html>`;
    }

    function openPdfPrintWindow(html) {
        const win = window.open('', '_blank');
        if (!win) {
            throw new Error('Pop-up blocked — allow pop-ups for this site to download the PDF.');
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
    }

    async function downloadLastMonthPdf() {
        if (!pdfBtn) return;
        pdfBtn.disabled = true;
        const prevLabel = pdfBtn.textContent;
        pdfBtn.textContent = 'Preparing PDF…';
        try {
            const range = previousCalendarMonthRange();
            // Cover previous calendar month even late in the following month.
            const daysNeeded = Math.min(120, range.lastDay + 40);
            const allDays = await fetchLogbookDays(daysNeeded);
            const monthDays = allDays
                .filter((d) => d?.date && d.date >= range.start && d.date <= range.end)
                .sort((a, b) => String(a.date).localeCompare(String(b.date)));
            openPdfPrintWindow(buildPdfDocumentHtml(range, monthDays));
            setStatus(
                `Opened ${range.monthLabel} logbook for PDF — choose Save as PDF in the print dialog.`,
                false,
            );
        } catch (err) {
            setStatus(err instanceof Error ? err.message : String(err), true);
        } finally {
            pdfBtn.disabled = false;
            pdfBtn.textContent = prevLabel || 'Download last month (PDF)';
        }
    }

    async function loadLogbook() {
        setStatus('Loading logbook…', false);
        try {
            renderDays(await fetchLogbookDays(45));
        } catch (err) {
            listEl.hidden = true;
            listEl.innerHTML = '';
            setStatus(err instanceof Error ? err.message : String(err), true);
        }
    }

    pdfBtn?.addEventListener('click', () => {
        void downloadLastMonthPdf();
    });

    void loadLogbook();
})();
