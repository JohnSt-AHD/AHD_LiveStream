/**
 * Hub race archive — search videos and photos on the AHD Google Drive.
 * Sign in with a Google account that can open the Shared Drive.
 */
(function () {
    const DRIVE_ID = '0ALQpKTQVtiMBUk9PVA';
    const DRIVE_URL = `https://drive.google.com/drive/folders/${DRIVE_ID}`;
    const API_URL = '/api/drive-archive';
    const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
    const LS_CLIENT = 'altitudeHdDriveOauthClientId_v1';
    const SS_TOKEN = 'altitudeHdDriveAccessToken_v1';
    const SS_EXPIRY = 'altitudeHdDriveAccessExpiry_v1';
    const SUGGESTIONS = [
        'Maadi',
        'Karapiro',
        'Nationals',
        'Christmas',
        'Masters',
        'Beach Sprints',
    ];
    const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021', '2020'];

    const thumbUrls = new Map();
    let tokenClient = null;
    let oauthClientId = '';

    const state = {
        q: '',
        also: [],
        sheet: null,
        type: 'all',
        folderId: DRIVE_ID,
        folderName: 'AHD Drive',
        parentId: null,
        crumbs: [{ id: DRIVE_ID, name: 'AHD Drive' }],
        nextPageToken: null,
        configured: null,
        loading: false,
    };

    function $(id) {
        return document.getElementById(id);
    }

    function driveSearchUrl(query, type) {
        const parts = [];
        const year = String(query || '').match(/\b((?:19|20)\d{2})\b/);
        if (query) parts.push(query);
        if (type === 'video') parts.push('type:video');
        if (type === 'image') parts.push('type:image');
        if (type === 'folder') parts.push('type:folder');
        if (year) {
            parts.push(`after:${year[1]}-01-01`);
            parts.push(`before:${Number(year[1]) + 1}-01-01`);
        }
        const q = encodeURIComponent(parts.join(' ').trim() || 'type:video OR type:image');
        return `https://drive.google.com/drive/search?q=${q}`;
    }

    function fmtSize(n) {
        if (n == null || !Number.isFinite(n)) return '';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
        return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    function fmtDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            });
        } catch {
            return '';
        }
    }

    function kindLabel(kind) {
        if (kind === 'video') return 'Video';
        if (kind === 'image') return 'Photo';
        if (kind === 'folder') return 'Folder';
        return 'File';
    }

    function setStatus(text, isError) {
        const el = $('hubArchiveStatus');
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('hub-archive-status--error', Boolean(isError));
    }

    function setTypeButtons() {
        document.querySelectorAll('[data-archive-type]').forEach((btn) => {
            const on = btn.getAttribute('data-archive-type') === state.type;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function readStoredClientId() {
        try {
            return String(localStorage.getItem(LS_CLIENT) || '').trim();
        } catch {
            return '';
        }
    }

    function saveClientId(value) {
        const id = String(value || '').trim();
        oauthClientId = id;
        try {
            if (id) localStorage.setItem(LS_CLIENT, id);
            else localStorage.removeItem(LS_CLIENT);
        } catch {
            /* ignore */
        }
    }

    function readToken() {
        try {
            const token = sessionStorage.getItem(SS_TOKEN) || '';
            const expiry = Number(sessionStorage.getItem(SS_EXPIRY) || 0);
            if (!token || !expiry || Date.now() >= expiry - 15000) {
                clearToken();
                return '';
            }
            return token;
        } catch {
            return '';
        }
    }

    function saveToken(token, expiresIn) {
        const seconds = Number(expiresIn);
        const ttl = Number.isFinite(seconds) && seconds > 0 ? seconds : 3500;
        try {
            sessionStorage.setItem(SS_TOKEN, token);
            sessionStorage.setItem(SS_EXPIRY, String(Date.now() + ttl * 1000));
        } catch {
            /* ignore */
        }
    }

    function clearToken() {
        try {
            sessionStorage.removeItem(SS_TOKEN);
            sessionStorage.removeItem(SS_EXPIRY);
        } catch {
            /* ignore */
        }
    }

    function authHeaders() {
        const token = readToken();
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    function revokeThumbs() {
        for (const url of thumbUrls.values()) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                /* ignore */
            }
        }
        thumbUrls.clear();
    }

    async function loadThumb(img, fileId) {
        if (thumbUrls.has(fileId)) {
            img.src = thumbUrls.get(fileId);
            return;
        }
        const res = await fetch(`${API_URL}?thumb=${encodeURIComponent(fileId)}`, {
            headers: authHeaders(),
        });
        if (!res.ok) throw new Error('thumb');
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) throw new Error('thumb');
        const url = URL.createObjectURL(blob);
        thumbUrls.set(fileId, url);
        img.src = url;
    }

    function updateAuthUi(signedIn) {
        const signIn = $('hubArchiveSignIn');
        const signOut = $('hubArchiveSignOut');
        const setup = $('hubArchiveOauthSetup');
        const signed = $('hubArchiveSignedIn');
        if (signIn) signIn.hidden = signedIn || !oauthClientId;
        if (signOut) signOut.hidden = !signedIn;
        if (signed) {
            signed.hidden = !signedIn;
        }
        if (setup) setup.hidden = Boolean(oauthClientId);
        const clientInput = $('hubArchiveClientId');
        if (clientInput && oauthClientId && !clientInput.value) clientInput.value = oauthClientId;
    }

    function gisReady() {
        return Boolean(window.google?.accounts?.oauth2?.initTokenClient);
    }

    function waitForGis() {
        if (gisReady()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const timer = setInterval(() => {
                if (gisReady()) {
                    clearInterval(timer);
                    resolve();
                } else if (Date.now() - started > 8000) {
                    clearInterval(timer);
                    reject(new Error('Google sign-in script did not load.'));
                }
            }, 50);
        });
    }

    function ensureTokenClient() {
        if (tokenClient || !oauthClientId || !gisReady()) return tokenClient;
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: oauthClientId,
            scope: SCOPE,
            callback: (response) => {
                if (response?.error) {
                    setStatus(response.error_description || response.error || 'Google sign-in failed.', true);
                    return;
                }
                if (response?.access_token) {
                    saveToken(response.access_token, response.expires_in);
                    updateAuthUi(true);
                    load({ reset: true });
                }
            },
        });
        return tokenClient;
    }

    async function signIn() {
        if (!oauthClientId) {
            setStatus('Save a Google OAuth Client ID first, then sign in.', true);
            $('hubArchiveOauthSetup')?.removeAttribute('hidden');
            $('hubArchiveClientId')?.focus();
            return;
        }
        try {
            await waitForGis();
            const client = ensureTokenClient();
            if (!client) throw new Error('Google sign-in is not available.');
            client.requestAccessToken({ prompt: readToken() ? '' : 'consent' });
        } catch (err) {
            setStatus(err instanceof Error ? err.message : 'Google sign-in failed.', true);
        }
    }

    function signOut() {
        const token = readToken();
        clearToken();
        updateAuthUi(false);
        revokeThumbs();
        if (token && window.google?.accounts?.oauth2?.revoke) {
            window.google.accounts.oauth2.revoke(token, () => {});
        }
        load({ reset: true });
    }

    function renderCrumbs() {
        const nav = $('hubArchiveCrumbs');
        if (!nav) return;
        nav.hidden = Boolean(state.q) || state.crumbs.length <= 1;
        nav.replaceChildren();
        if (nav.hidden) return;

        state.crumbs.forEach((crumb, i) => {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.className = 'hub-archive-crumb-sep';
                sep.textContent = '/';
                nav.appendChild(sep);
            }
            const last = i === state.crumbs.length - 1;
            if (last) {
                const span = document.createElement('span');
                span.className = 'hub-archive-crumb is-current';
                span.textContent = crumb.name;
                nav.appendChild(span);
            } else {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'hub-archive-crumb';
                btn.textContent = crumb.name;
                btn.addEventListener('click', () => {
                    state.crumbs = state.crumbs.slice(0, i + 1);
                    state.folderId = crumb.id;
                    state.folderName = crumb.name;
                    state.parentId = i > 0 ? state.crumbs[i - 1].id : null;
                    load({ reset: true });
                });
                nav.appendChild(btn);
            }
        });
    }

    function openPreview(file) {
        const dialog = $('hubArchivePreview');
        const frame = $('hubArchivePreviewFrame');
        const title = $('hubArchivePreviewTitle');
        const open = $('hubArchivePreviewOpen');
        if (!dialog || !frame) {
            window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
            return;
        }
        if (title) title.textContent = file.name;
        if (open) open.href = file.webViewLink;
        frame.src = file.previewLink || `https://drive.google.com/file/d/${file.id}/preview`;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.hidden = false;
    }

    function closePreview() {
        const dialog = $('hubArchivePreview');
        const frame = $('hubArchivePreviewFrame');
        if (frame) frame.src = 'about:blank';
        if (!dialog) return;
        if (typeof dialog.close === 'function' && dialog.open) dialog.close();
        else dialog.hidden = true;
    }

    function renderFiles(files, append) {
        const list = $('hubArchiveResults');
        if (!list) return;
        if (!append) {
            revokeThumbs();
            list.replaceChildren();
        }

        for (const file of files) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `hub-archive-item hub-archive-item--${file.kind}`;

            const thumbWrap = document.createElement('span');
            thumbWrap.className = 'hub-archive-thumb';
            thumbWrap.setAttribute('aria-hidden', 'true');

            if (file.kind !== 'folder') {
                const img = document.createElement('img');
                img.alt = '';
                img.loading = 'lazy';
                thumbWrap.appendChild(img);
                loadThumb(img, file.id).catch(() => {
                    img.remove();
                    thumbWrap.textContent = file.kind === 'video' ? '▶' : '◉';
                });
            } else {
                thumbWrap.textContent = '📁';
            }

            const meta = document.createElement('span');
            meta.className = 'hub-archive-item-text';
            const title = document.createElement('strong');
            title.textContent = file.name;
            const sub = document.createElement('span');
            const bits = [kindLabel(file.kind), fmtDate(file.modifiedTime), fmtSize(file.size)].filter(Boolean);
            sub.textContent = bits.join(' · ');
            meta.append(title, sub);
            item.append(thumbWrap, meta);

            item.addEventListener('click', () => {
                if (file.kind === 'folder') {
                    state.q = '';
                    const input = $('hubArchiveQuery');
                    if (input) input.value = '';
                    state.crumbs = [...state.crumbs, { id: file.id, name: file.name }];
                    state.folderId = file.id;
                    state.folderName = file.name;
                    state.parentId = state.crumbs.at(-2)?.id || DRIVE_ID;
                    load({ reset: true });
                    return;
                }
                openPreview(file);
            });

            list.appendChild(item);
        }

        list.hidden = list.childElementCount === 0;
    }

    function renderSheetMatches(sheet) {
        const el = $('hubArchiveSheets');
        if (!el) return;
        el.replaceChildren();
        const matches = sheet?.matches || [];
        state.sheet = sheet || null;
        if (!matches.length) {
            el.hidden = true;
            return;
        }

        const heading = document.createElement('p');
        heading.className = 'hub-archive-sheets-label';
        const kind = sheet.mode === 'athlete'
            ? 'from competitor sheets'
            : sheet.mode === 'event'
                ? 'matching that event'
                : 'from daysheets';
        const extra = sheet.total > matches.length
            ? ` Showing ${matches.length} of ${sheet.total}.`
            : '';
        heading.textContent = `${sheet.total} race${sheet.total === 1 ? '' : 's'} ${kind}.${extra}`;
        el.appendChild(heading);

        const list = document.createElement('div');
        list.className = 'hub-archive-sheet-list';
        for (const row of matches) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hub-archive-sheet';
            const title = document.createElement('strong');
            title.textContent = row.hubTitle || `${row.shortName || row.name} ${row.year || ''} · Race ${row.race}`.replace(/\s+/g, ' ').trim();
            const sub = document.createElement('span');
            sub.textContent = [
                row.matchedName,
                row.eventType,
                row.round,
                row.time,
                row.dateLabel,
            ].filter(Boolean).join(' · ');
            btn.append(title, sub);
            btn.addEventListener('click', () => {
                const query = row.hubTitle || row.driveQuery || `${row.shortName} ${row.year} Race ${row.raceNum}`;
                const input = $('hubArchiveQuery');
                if (input) input.value = query;
                state.q = query;
                state.also = [];
                state.folderId = DRIVE_ID;
                state.crumbs = [{ id: DRIVE_ID, name: state.crumbs[0]?.name || 'AHD Drive' }];
                load({ reset: true, keepPicker: true });
            });
            list.appendChild(btn);
        }
        el.appendChild(list);
        el.hidden = false;
    }

    function renderVideoSelect(sheet) {
        const sel = $('hubArchiveVideoSelect');
        if (!sel) return;
        const picker = sheet?.picker || [];
        const current = sel.value;
        sel.replaceChildren();
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = picker.length
            ? `${picker.length} Hub file name${picker.length === 1 ? '' : 's'} — pick a race`
            : 'Search to list RowIT file names';
        sel.appendChild(blank);
        for (const item of picker) {
            const opt = document.createElement('option');
            opt.value = item.title;
            const extra = [item.round, item.dateLabel].filter(Boolean).join(' · ');
            opt.textContent = extra ? `${item.title}  (${extra})` : item.title;
            sel.appendChild(opt);
        }
        sel.disabled = picker.length === 0;
        if (current && picker.some((item) => item.title === current)) {
            sel.value = current;
        }
    }

    function sheetStatus(fileCount, signedIn) {
        const sheet = state.sheet;
        const n = sheet?.total || 0;
        const q = state.q;
        if (n && fileCount) {
            return `${n} race${n === 1 ? '' : 's'} in the daysheets. ${fileCount} Drive file${fileCount === 1 ? '' : 's'} for “${q}”.`;
        }
        if (n) {
            return signedIn
                ? `${n} race${n === 1 ? '' : 's'} in the daysheets. No matching Drive files yet — try a race card, or open Google Drive.`
                : `${n} race${n === 1 ? '' : 's'} in the daysheets. Sign in to find matching videos and photos.`;
        }
        return '';
    }

    function updateMore(token) {
        const btn = $('hubArchiveMore');
        if (!btn) return;
        state.nextPageToken = token || null;
        btn.hidden = !state.nextPageToken;
        btn.disabled = false;
    }

    async function fetchPage(pageToken) {
        const params = new URLSearchParams();
        if (state.q) params.set('q', state.q);
        else params.set('folder', state.folderId);
        if (state.type !== 'all') params.set('type', state.type);
        if (pageToken) params.set('pageToken', pageToken);
        if (!pageToken && state.q) {
            for (const extra of state.also || []) {
                if (extra && extra !== state.q) params.append('also', extra);
            }
        }

        const res = await fetch(`${API_URL}?${params.toString()}`, {
            headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            clearToken();
            updateAuthUi(false);
        }
        if (!res.ok && data.configured !== false) {
            const extra = [data.searchRevision, data.driveQ].filter(Boolean).join(' · ');
            throw new Error(`${data.error || `HTTP ${res.status}`}${extra ? ` (${extra})` : ''}`);
        }
        return data;
    }

    function openOnDrive() {
        const query = (state.also && state.also[0]) || state.q;
        const url = query || state.type !== 'all'
            ? driveSearchUrl(query, state.type)
            : DRIVE_URL;
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    async function load(options = {}) {
        const more = Boolean(options.more);
        const list = $('hubArchiveResults');
        const moreBtn = $('hubArchiveMore');
        if (state.loading) return;
        state.loading = true;
        if (moreBtn) moreBtn.disabled = true;
        if (!more) {
            setStatus(state.q ? 'Looking up daysheets…' : 'Loading archive…');
            if (list) list.replaceChildren();
            updateMore(null);
            if (!options.keepPicker) {
                renderSheetMatches(null);
                renderVideoSelect(null);
                state.also = [];
                if (state.q && globalThis.HubArchiveSheetSearch?.search) {
                    try {
                        const sheet = await globalThis.HubArchiveSheetSearch.search(state.q);
                        state.also = sheet.also || [];
                        renderSheetMatches(sheet);
                        renderVideoSelect(sheet);
                    } catch {
                        renderSheetMatches(null);
                        renderVideoSelect(null);
                    }
                }
            }
        }
        renderCrumbs();
        setTypeButtons();
        updateAuthUi(Boolean(readToken()));

        try {
            const data = await fetchPage(more ? state.nextPageToken : undefined);
            state.configured = Boolean(data.configured);

            if (data.oauthClientId && !oauthClientId) {
                oauthClientId = data.oauthClientId;
                tokenClient = null;
            }

            const openBtn = $('hubArchiveOpenDrive');
            const driveQ = (state.also && state.also[0]) || state.q;
            if (openBtn) {
                openBtn.href = state.q
                    ? driveSearchUrl(driveQ, state.type)
                    : (data.driveUrl || DRIVE_URL);
            }

            if (data.configured === false) {
                renderFiles([]);
                const signedIn = Boolean(readToken());
                const fromSheets = sheetStatus(0, signedIn);
                const hint = signedIn
                    ? (data.error || 'Could not list Drive with this account.')
                    : (oauthClientId
                        ? 'Sign in with the Google account that can open the AHD Drive.'
                        : 'Add a Google OAuth Client ID, then sign in to list videos and photos.');
                setStatus(fromSheets || hint, signedIn && !fromSheets);
                const fallback = $('hubArchiveFallback');
                if (fallback) fallback.hidden = Boolean(oauthClientId);
                updateAuthUi(signedIn);
                return;
            }

            const fallback = $('hubArchiveFallback');
            if (fallback) fallback.hidden = true;
            $('hubArchiveOauthSetup')?.setAttribute('hidden', '');

            if (!data.ok) {
                throw new Error(data.error || 'Drive request failed');
            }

            if (!more && !state.q && data.folderName) {
                state.folderName = data.folderName;
                if (state.crumbs.length === 1 && state.folderId === (data.driveId || DRIVE_ID)) {
                    state.crumbs[0] = { id: data.driveId || DRIVE_ID, name: data.folderName };
                }
                renderCrumbs();
            }

            renderFiles(data.files || [], more);
            updateMore(data.nextPageToken);

            const count = ($('hubArchiveResults')?.childElementCount) || 0;
            const fromSheets = !more ? sheetStatus(count, true) : '';
            if (fromSheets) {
                setStatus(fromSheets);
            } else if (count === 0) {
                setStatus(state.q
                    ? `No matches for “${state.q}”. Try an athlete, race number, or year.`
                    : 'This folder is empty.');
            } else if (state.q) {
                setStatus(`${count} match${count === 1 ? '' : 'es'} for “${state.q}”.`);
            } else {
                setStatus(`${count} item${count === 1 ? '' : 's'} in ${state.folderName}.`);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not load Drive.';
            setStatus(message, true);
            const fallback = $('hubArchiveFallback');
            if (fallback) fallback.hidden = Boolean(readToken());
        } finally {
            state.loading = false;
            if (moreBtn && state.nextPageToken) moreBtn.disabled = false;
        }
    }

    function applyQueryFromInput() {
        const input = $('hubArchiveQuery');
        state.q = String(input?.value || '').trim();
        if (state.q) {
            state.folderId = DRIVE_ID;
            state.crumbs = [{ id: DRIVE_ID, name: state.crumbs[0]?.name || 'AHD Drive' }];
        }
        load({ reset: true });
    }

    function addChip(row, label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hub-archive-chip';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            const input = $('hubArchiveQuery');
            if (input) input.value = label;
            state.q = label;
            state.folderId = DRIVE_ID;
            state.crumbs = [{ id: DRIVE_ID, name: state.crumbs[0]?.name || 'AHD Drive' }];
            load({ reset: true });
        });
        row.appendChild(btn);
    }

    function initSuggestions() {
        const row = $('hubArchiveSuggestions');
        if (row && row.dataset.bound !== '1') {
            row.dataset.bound = '1';
            SUGGESTIONS.forEach((label) => addChip(row, label));
        }
        const years = $('hubArchiveYears');
        if (years && years.dataset.bound !== '1') {
            years.dataset.bound = '1';
            YEARS.forEach((label) => addChip(years, label));
        }
    }

    async function loadConfig() {
        oauthClientId = readStoredClientId();
        try {
            const local = await fetch('data/google-drive-oauth.json', { cache: 'no-store' });
            if (local.ok) {
                const json = await local.json();
                if (!oauthClientId && json?.clientId) oauthClientId = String(json.clientId).trim();
            }
        } catch {
            /* optional file */
        }
        try {
            const res = await fetch(`${API_URL}?config=1`, { headers: { Accept: 'application/json' } });
            const data = await res.json().catch(() => ({}));
            if (!oauthClientId && data?.oauthClientId) {
                oauthClientId = String(data.oauthClientId).trim();
            }
        } catch {
            /* ignore */
        }
        const originEl = $('hubArchiveOauthOrigin');
        if (originEl) originEl.textContent = location.origin;
        const input = $('hubArchiveClientId');
        if (input && oauthClientId) input.value = oauthClientId;
        updateAuthUi(Boolean(readToken()));
    }

    function init() {
        const root = $('hubDriveArchive');
        if (!root || root.dataset.bound === '1') return;
        root.dataset.bound = '1';

        initSuggestions();
        setTypeButtons();

        $('hubArchiveForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            applyQueryFromInput();
        });

        document.querySelectorAll('[data-archive-type]').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.type = btn.getAttribute('data-archive-type') || 'all';
                setTypeButtons();
                load({ reset: true });
            });
        });

        $('hubArchiveMore')?.addEventListener('click', () => {
            if (state.nextPageToken) load({ reset: false, more: true });
        });

        $('hubArchiveClear')?.addEventListener('click', () => {
            const input = $('hubArchiveQuery');
            if (input) input.value = '';
            state.q = '';
            state.also = [];
            state.sheet = null;
            state.folderId = DRIVE_ID;
            state.crumbs = [{ id: DRIVE_ID, name: state.crumbs[0]?.name || 'AHD Drive' }];
            renderVideoSelect(null);
            load({ reset: true });
        });

        $('hubArchiveVideoSelect')?.addEventListener('change', () => {
            const sel = $('hubArchiveVideoSelect');
            const title = String(sel?.value || '').trim();
            if (!title) return;
            const input = $('hubArchiveQuery');
            if (input) input.value = title;
            state.q = title;
            state.also = [];
            state.folderId = DRIVE_ID;
            state.crumbs = [{ id: DRIVE_ID, name: state.crumbs[0]?.name || 'AHD Drive' }];
            load({ reset: true, keepPicker: true });
        });

        $('hubArchiveOpenDriveFallback')?.addEventListener('click', (event) => {
            event.preventDefault();
            openOnDrive();
        });

        $('hubArchiveSignIn')?.addEventListener('click', () => {
            signIn();
        });

        $('hubArchiveSignOut')?.addEventListener('click', () => {
            signOut();
        });

        $('hubArchiveSaveClient')?.addEventListener('click', () => {
            const value = $('hubArchiveClientId')?.value || '';
            saveClientId(value);
            tokenClient = null;
            updateAuthUi(Boolean(readToken()));
            if (oauthClientId) {
                setStatus('Client ID saved. Sign in with Google to load the archive.');
                signIn();
            } else {
                setStatus('Paste a Google OAuth Client ID to enable sign-in.', true);
            }
        });

        $('hubArchivePreviewClose')?.addEventListener('click', () => closePreview());
        $('hubArchivePreview')?.addEventListener('close', () => {
            const frame = $('hubArchivePreviewFrame');
            if (frame) frame.src = 'about:blank';
        });

        loadConfig().then(() => load({ reset: true }));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
