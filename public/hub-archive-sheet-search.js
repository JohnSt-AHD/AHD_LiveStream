/**
 * Archive search against local RowIT daysheets and competitor sheets.
 * Resolves an athlete or race number to the event/regatta terms Drive filenames use.
 */
(function (global) {
    const MAX_MATCHES = 12;
    const MAX_PICKER = 80;
    const REGATTA_ONLY = new Set([
        'maadi', 'nicc', 'niss', 'siss', 'nationals', 'masters', 'beach',
        'university', 'karapiro', 'christmas', 'club', 'champs', 'cup',
        'coastal', 'sprint', 'sprints',
    ]);
    const EVENT_HINT = /\b(?:u1[5-9]|u2[0-3]|open|club|masters?|novice|para|[1248]x|[1248]\+|2-|1x|4x\+|8\+|lx|mix)\b/i;

    const SHORT_NAME = [
        [/^mads/i, 'Maadi'],
        [/^nicc/i, 'NICC'],
        [/^nzcc/i, 'Nationals'],
        [/^niss/i, 'NISS'],
        [/^siss/i, 'SISS'],
        [/^nzuu/i, 'University'],
        [/^nzmm/i, 'Masters'],
        [/^cnzb/i, 'Beach'],
        [/^u19/i, 'U19'],
        [/^wrch/i, 'Worlds'],
        [/^nzsr/i, 'Schools'],
        [/^bsnz/i, 'Beach'],
        [/^kapi/i, 'Karapiro'],
    ];

    let indexPromise = null;
    let index = null;

    function parseCsvLine(line) {
        const out = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQ) {
                if (c === '"' && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else if (c === '"') {
                    inQ = false;
                } else {
                    cur += c;
                }
            } else if (c === '"') {
                inQ = true;
            } else if (c === ',') {
                out.push(cur);
                cur = '';
            } else {
                cur += c;
            }
        }
        out.push(cur);
        return out;
    }

    function parseRaceLabel(raw) {
        const s = String(raw || '').trim();
        const withLetter = s.match(/^(\d+)\s*\(([A-Za-z])\)\s*$/);
        if (withLetter) {
            return {
                raceNum: parseInt(withLetter[1], 10),
                label: `${withLetter[1]} (${withLetter[2].toUpperCase()})`,
            };
        }
        const plain = s.match(/^(\d+)$/);
        if (plain) return { raceNum: parseInt(plain[1], 10), label: plain[1] };
        return { raceNum: null, label: s };
    }

    function parseDayHeader(line) {
        const m = String(line || '').match(
            /DAY\s+\d+:\s+(\w+)\s+(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
        );
        if (!m) return null;
        const months = {
            january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
            april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
            august: 7, aug: 7, september: 8, sep: 8, sept: 8,
            october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
        };
        const month = months[m[3].toLowerCase()];
        if (month === undefined) return null;
        const date = new Date(parseInt(m[4], 10), month, parseInt(m[2], 10));
        return {
            date,
            ymd: formatYmd(date),
            year: date.getFullYear(),
            label: `${m[1]} ${m[2]} ${m[3]} ${m[4]}`,
        };
    }

    function formatYmd(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function normalize(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/['’]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function shortName(code, fullName) {
        const hit = SHORT_NAME.find(([re]) => re.test(code));
        if (hit) return hit[1];
        const first = String(fullName || '').split(/\s+/).filter(Boolean)[0];
        return first || code;
    }

    function yearFromCode(code) {
        const m = String(code || '').match(/(20\d{2})$/);
        if (m) return parseInt(m[1], 10);
        const ct = String(code || '').match(/_ct_(\d{2})$/);
        if (ct) return 2000 + parseInt(ct[1], 10);
        return null;
    }

    function splitNames(raw) {
        return String(raw || '')
            .split(',')
            .map((n) => n.trim())
            .filter((n) => n.length >= 2 && /[a-z]/i.test(n));
    }

    function clubCodes(cols) {
        const out = [];
        for (let i = 6; i <= 14; i++) {
            const cell = String(cols[i] || '').trim();
            const m = cell.match(/^([A-Za-z]{3,5})\b/);
            if (m && !out.includes(m[1].toUpperCase())) out.push(m[1].toUpperCase());
        }
        return out;
    }

    function eventTokens(eventType) {
        return String(eventType || '')
            .split(/\s+/)
            .filter((w) => w.length >= 2 && !/^[BG]$/i.test(w));
    }

    function parseSheetRows(code, name, daysheetText, competitorsText) {
        const byKey = new Map();
        const fallbackYear = yearFromCode(code);
        const short = shortName(code, name);
        let day = null;

        function ensureRow(cols, fromCompetitors) {
            const info = parseRaceLabel(cols[0]);
            if (!info.raceNum) return null;
            const division = String(cols[5] || '').trim();
            const key = `${info.label}|${division}|${day?.ymd || ''}`;
            let row = byKey.get(key);
            if (!row) {
                row = {
                    code,
                    name,
                    shortName: short,
                    year: day?.year || fallbackYear,
                    date: day?.ymd || '',
                    dateLabel: day?.label || '',
                    raceNum: info.raceNum,
                    race: info.label,
                    time: String(cols[1] || '').trim(),
                    eventNum: String(cols[2] || '').trim(),
                    eventType: String(cols[3] || '').trim(),
                    round: String(cols[4] || '').trim(),
                    division,
                    names: [],
                    clubs: [],
                };
                byKey.set(key, row);
            }
            if (!fromCompetitors) {
                if (!row.eventType && cols[3]) row.eventType = String(cols[3]).trim();
                if (!row.round && cols[4]) row.round = String(cols[4]).trim();
                if (!row.time && cols[1]) row.time = String(cols[1]).trim();
                const clubs = clubCodes(cols);
                if (clubs.length) row.clubs = clubs;
            } else {
                const names = splitNames(cols[6]);
                if (names.length) row.names = names;
                if (cols[3] && !row.eventType) row.eventType = String(cols[3]).trim();
                if (cols[4] && !row.round) row.round = String(cols[4]).trim();
            }
            return row;
        }

        function walk(text, fromCompetitors) {
            day = null;
            for (const line of String(text || '').split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (/^DAY\s+\d+:/i.test(trimmed)) {
                    day = parseDayHeader(trimmed);
                    continue;
                }
                if (/^Race,/i.test(trimmed) || /as at/i.test(trimmed)) continue;
                if (!day) continue;
                const cols = parseCsvLine(trimmed);
                if (cols.length < 5) continue;
                ensureRow(cols, fromCompetitors);
            }
        }

        walk(daysheetText, false);
        walk(competitorsText, true);
        return [...byKey.values()];
    }

    async function fetchCsv(code, fileId) {
        if (global.RegattaCsvArchive?.fetchArchiveCsv) {
            try {
                const result = await global.RegattaCsvArchive.fetchArchiveCsv(code, fileId);
                return result?.text || '';
            } catch {
                return '';
            }
        }
        try {
            const res = await fetch(`data/archives/${code}/latest/${fileId}.csv`, { cache: 'force-cache' });
            if (!res.ok) return '';
            return res.text();
        } catch {
            return '';
        }
    }

    function hasArchivedSheet(reg) {
        const files = reg?.files || {};
        return Boolean(files.daysheet?.bytes || files.competitors?.bytes);
    }

    async function listRegattas() {
        const byCode = new Map();
        if (global.RegattaCsvArchive?.loadRegattaConfig) {
            const config = await global.RegattaCsvArchive.loadRegattaConfig();
            for (const row of config.regattas || []) {
                const code = String(row.code || '').trim();
                if (code) byCode.set(code, row.name || code);
            }
        }
        byCode.set('u19_ct_26', byCode.get('u19_ct_26') || 'U19 Coastal Selection Trial 2026');

        let manifest = { regattas: {} };
        if (global.RegattaCsvArchive?.loadManifest) {
            manifest = await global.RegattaCsvArchive.loadManifest();
        } else {
            try {
                const res = await fetch('data/regatta-archives.json', { cache: 'force-cache' });
                if (res.ok) manifest = await res.json();
            } catch {
                /* empty */
            }
        }
        for (const [code, reg] of Object.entries(manifest.regattas || {})) {
            if (byCode.has(code) && reg?.name) byCode.set(code, reg.name);
        }
        return byCode;
    }

    async function loadIndex() {
        if (index) return index;
        if (indexPromise) return indexPromise;
        indexPromise = (async () => {
            const races = [];
            const byCode = await listRegattas();
            await Promise.all([...byCode.entries()].map(async ([code, name]) => {
                const [daysheet, competitors] = await Promise.all([
                    fetchCsv(code, 'daysheet'),
                    fetchCsv(code, 'competitors'),
                ]);
                if (!daysheet && !competitors) return;
                races.push(...parseSheetRows(code, name || code, daysheet, competitors));
            }));
            index = { races };
            return index;
        })().catch((err) => {
            indexPromise = null;
            throw err;
        });
        return indexPromise;
    }

    function parseQuery(raw) {
        const years = [];
        let rest = String(raw || '')
            .replace(/\b((?:19|20)\d{2})\b/g, (_, year) => {
                if (!years.includes(year)) years.push(year);
                return ' ';
            });
        let raceNum = null;
        rest = rest.replace(/\b(?:race|r|#)\s*(\d{1,3})\b/gi, (_, n) => {
            raceNum = parseInt(n, 10);
            return ' ';
        });
        rest = rest.replace(/\s+/g, ' ').trim();
        if (raceNum == null && /^\d{1,3}$/.test(rest)) {
            const n = parseInt(rest, 10);
            if (n >= 1 && n <= 399) {
                raceNum = n;
                rest = '';
            }
        }
        return { years, raceNum, rest, restNorm: normalize(rest) };
    }

    function nameMatches(athlete, queryNorm) {
        const n = normalize(athlete);
        if (!n || !queryNorm) return 0;
        if (n === queryNorm) return 100;
        if (n.includes(queryNorm) && queryNorm.includes(' ')) return 92;
        const qParts = queryNorm.split(' ').filter(Boolean);
        const nParts = n.split(' ').filter(Boolean);
        if (!qParts.length || !nParts.length) return 0;
        if (qParts.length >= 2) {
            const all = qParts.every((p) => nParts.some((np) => np === p || (p.length >= 3 && np.startsWith(p))));
            if (all) return 88;
            return 0;
        }
        const q = qParts[0];
        if (q.length < 4) return 0;
        const last = nParts[nParts.length - 1];
        if (last === q) return 60;
        if (nParts.some((np) => np === q)) return 45;
        return 0;
    }

    function eventMatches(eventType, queryNorm) {
        const e = normalize(eventType);
        if (!e || !queryNorm) return 0;
        if (e === queryNorm) return 80;
        const qParts = queryNorm.split(' ').filter((w) => w.length >= 2);
        if (!qParts.length) return 0;
        if (qParts.every((p) => e.includes(p))) return 70;
        return 0;
    }

    function isRegattaOnly(queryNorm) {
        if (!queryNorm) return true;
        const parts = queryNorm.split(' ').filter(Boolean);
        return parts.length > 0 && parts.every((p) => REGATTA_ONLY.has(p) || p.length <= 2);
    }

    function hubRegattaLabel(code) {
        const raw = String(code || '').trim();
        const stripped = raw.replace(/20\d{2}$/i, '').replace(/_?\d{2}$/i, '').replace(/[_-]+$/g, '');
        return (stripped || raw).toUpperCase();
    }

    function hubEventSlug(eventType) {
        return String(eventType || '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_');
    }

    function hubDateLabel(ymd) {
        const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return '';
        return `${m[3]}-${m[2]}-${m[1]}`;
    }

    function isNamedFinal(round) {
        return /^(?:a\s*)?final\b/i.test(String(round || '').trim());
    }

    function hubTitle(row) {
        const parts = [
            hubRegattaLabel(row.code),
            hubEventSlug(row.eventType),
            hubDateLabel(row.date),
        ].filter(Boolean);
        let title = parts.join(' ');
        if (row.raceNum && !isNamedFinal(row.round)) {
            title = `${title} Race ${row.raceNum}`.trim();
        }
        return title.replace(/\s+/g, ' ').trim();
    }

    function decorate(row, extra) {
        const eventBits = eventTokens(row.eventType);
        const title = hubTitle(row);
        const driveQuery = title || [row.shortName, row.year, 'Race', row.raceNum].filter(Boolean).join(' ');
        const driveEventQuery = [row.shortName, row.year, ...eventBits].filter(Boolean).join(' ');
        return {
            ...row,
            ...extra,
            hubTitle: title,
            driveQuery,
            driveEventQuery,
        };
    }

    async function search(rawQuery) {
        const q = String(rawQuery || '').trim();
        if (q.length < 1) {
            return { matches: [], picker: [], mode: '', also: [], total: 0 };
        }
        const parsed = parseQuery(q);
        const wantsSheets = Boolean(
            parsed.raceNum
            || parsed.years.length
            || parsed.restNorm,
        );
        if (!wantsSheets) {
            return { matches: [], picker: [], mode: '', also: [], total: 0 };
        }

        const { races } = await loadIndex();
        const scored = [];
        const restLooksLikeEvent = EVENT_HINT.test(parsed.rest);
        const restLooksLikeRegatta = Boolean(parsed.restNorm) && isRegattaOnly(parsed.restNorm);
        const restLooksLikeName = Boolean(parsed.restNorm)
            && !restLooksLikeEvent
            && !restLooksLikeRegatta
            && /[a-z]/i.test(parsed.rest);

        for (const row of races) {
            if (parsed.years.length && !parsed.years.includes(String(row.year || ''))) continue;
            if (parsed.raceNum != null && row.raceNum !== parsed.raceNum) continue;

            let score = 0;
            let matchedName = '';
            let mode = 'race';

            if (parsed.restNorm && restLooksLikeName) {
                let best = 0;
                for (const name of row.names) {
                    const s = nameMatches(name, parsed.restNorm);
                    if (s > best) {
                        best = s;
                        matchedName = name;
                    }
                }
                if (best === 0) continue;
                score = best;
                mode = 'athlete';
            } else if (parsed.restNorm && restLooksLikeEvent) {
                score = eventMatches(row.eventType, parsed.restNorm);
                if (score === 0) continue;
                mode = 'event';
            } else if (parsed.restNorm && restLooksLikeRegatta) {
                const blob = normalize(`${row.shortName} ${row.name} ${row.code}`);
                if (!parsed.restNorm.split(' ').every((p) => blob.includes(p))) continue;
                score = 25;
                mode = 'race';
            } else if (parsed.restNorm) {
                const eventScore = eventMatches(row.eventType, parsed.restNorm);
                let nameScore = 0;
                let name = '';
                for (const athlete of row.names) {
                    const s = nameMatches(athlete, parsed.restNorm);
                    if (s > nameScore) {
                        nameScore = s;
                        name = athlete;
                    }
                }
                const regattaHit = normalize(`${row.shortName} ${row.name}`).includes(parsed.restNorm);
                score = Math.max(eventScore, nameScore, regattaHit ? 20 : 0);
                if (score === 0) continue;
                if (nameScore >= eventScore) {
                    mode = 'athlete';
                    matchedName = name;
                } else {
                    mode = eventScore ? 'event' : 'race';
                }
            } else if (parsed.raceNum != null) {
                score = 75;
                mode = 'race';
            } else if (parsed.years.length) {
                score = 15;
                mode = 'race';
            } else {
                continue;
            }

            if (parsed.raceNum != null) score += 8;
            scored.push(decorate(row, { score, matchedName, matchKind: mode }));
        }

        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
            if (dateCmp) return dateCmp;
            if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
            return (a.raceNum || 0) - (b.raceNum || 0);
        });

        const total = scored.length;
        const matches = scored.slice(0, MAX_MATCHES);
        const mode = matches[0]?.matchKind || '';
        const picker = [];
        const pickerSeen = new Set();
        for (const row of scored) {
            const title = row.hubTitle;
            if (!title || pickerSeen.has(title)) continue;
            pickerSeen.add(title);
            picker.push({
                title,
                race: row.race,
                eventType: row.eventType,
                round: row.round,
                dateLabel: row.dateLabel,
            });
            if (picker.length >= MAX_PICKER) break;
        }
        const also = [];
        const seen = new Set();
        for (const row of matches) {
            for (const term of [row.hubTitle, row.driveEventQuery]) {
                if (!term || seen.has(term)) continue;
                seen.add(term);
                also.push(term);
                if (also.length >= 3) break;
            }
            if (also.length >= 3) break;
        }

        return { matches, picker, mode, also, total };
    }

    global.HubArchiveSheetSearch = {
        search,
        loadIndex,
        parseQuery,
    };
})(typeof window !== 'undefined' ? window : globalThis);
