import {
  loadRegatta,
  REGATTA,
  racePhase,
  msOfDayFromDate,
  formatMsOfDay,
} from './data.js';
import { createLiveCourse, fetchRaceSnapshot, unofficialPlacings } from './live-course.js';
import { enhanceLogoImages } from './logo-cutout.js';

const LS_FOLLOWS = 'regattaNzFollows_v1';
const LS_CLOCK = 'regattaNzDemoClock_v1';

const state = {
  data: null,
  tab: 'home',
  followMode: 'club',
  search: '',
  selectedRaceId: null,
  follows: loadFollows(),
  liveTimer: null,
  homeTimer: null,
  liveCourse: null,
  liveError: null,
  lastRaceSnap: null,
  expanded: new Set(),
  scheduleDayIndex: 1,
  /** null = use device time-of-day; number = fixed ms of day for demo */
  clockOverrideMs: loadClockOverride(),
};

const main = document.getElementById('main');
const topSub = document.getElementById('topSub');
const btnBack = document.getElementById('btnBack');
const btnLiveJump = document.getElementById('btnLiveJump');
const tabbar = document.getElementById('tabbar');

function loadFollows() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_FOLLOWS) || '{}');
    return {
      clubs: Array.isArray(raw.clubs) ? raw.clubs : [],
      athletes: Array.isArray(raw.athletes) ? raw.athletes : [],
    };
  } catch {
    return { clubs: [], athletes: [] };
  }
}

function saveFollows() {
  localStorage.setItem(LS_FOLLOWS, JSON.stringify(state.follows));
}

function loadClockOverride() {
  try {
    const raw = localStorage.getItem(LS_CLOCK);
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function saveClockOverride() {
  if (state.clockOverrideMs == null) localStorage.removeItem(LS_CLOCK);
  else localStorage.setItem(LS_CLOCK, String(state.clockOverrideMs));
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nowMs() {
  return state.clockOverrideMs != null ? state.clockOverrideMs : msOfDayFromDate();
}

function setTab(tab) {
  state.tab = tab;
  state.selectedRaceId = null;
  stopLive();
  for (const btn of tabbar.querySelectorAll('.tab')) {
    btn.classList.toggle('is-active', btn.dataset.tab === tab);
  }
  render();
}

function stopLive() {
  if (state.liveTimer) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
  }
}

function stopHomeTimer() {
  if (state.homeTimer) {
    clearInterval(state.homeTimer);
    state.homeTimer = null;
  }
}

function racesForFollows() {
  const { races } = state.data;
  const clubSet = new Set(state.follows.clubs);
  const athleteSet = new Set(state.follows.athletes.map((n) => n.toLowerCase()));
  const out = [];
  for (const race of races) {
    const matchedLanes = race.lanes.filter((l) => clubSet.has(l.clubId));
    const matchedAthletes = race.athletes.filter((n) => athleteSet.has(n.toLowerCase()));
    if (!matchedLanes.length && !matchedAthletes.length) continue;
    out.push({ race, matchedLanes, matchedAthletes });
  }
  return out;
}

function isFollowingClub(id) {
  return state.follows.clubs.includes(id);
}

function isFollowingAthlete(name) {
  return state.follows.athletes.some((n) => n.toLowerCase() === name.toLowerCase());
}

function toggleClub(id) {
  if (isFollowingClub(id)) {
    state.follows.clubs = state.follows.clubs.filter((c) => c !== id);
  } else {
    state.follows.clubs = [...state.follows.clubs, id];
  }
  saveFollows();
  render();
}

function toggleAthlete(name) {
  if (isFollowingAthlete(name)) {
    state.follows.athletes = state.follows.athletes.filter(
      (n) => n.toLowerCase() !== name.toLowerCase(),
    );
  } else {
    state.follows.athletes = [...state.follows.athletes, name];
  }
  saveFollows();
  render();
}

function followedLaneForRace(race) {
  if (!race) return null;
  const clubSet = new Set(state.follows.clubs);
  const hit = race.lanes.find((l) => clubSet.has(l.clubId));
  return hit ? hit.lane : null;
}

function laneLabelMap(race) {
  const map = new Map();
  if (!race) return map;
  for (const l of race.lanes) {
    map.set(String(l.lane), {
      code: l.clubCode,
      logoUrl: l.logoUrl || null,
      clubName: l.clubName || l.clubCode,
    });
  }
  return map;
}

function laneInfo(race, lane) {
  return laneLabelMap(race).get(String(lane)) || null;
}

function renderLivestreamCard() {
  const stream = state.data?.meta?.livestream || REGATTA.livestream || {};
  const label = stream.label || 'Watch the livestream';
  if (stream.active && stream.url) {
    return `<div class="panel panel--stream">
      <h2>Livestream</h2>
      <p class="panel__lead">${escapeHtml(state.data.meta.venue)} · race coverage</p>
      <a class="btn btn--live" href="${escapeHtml(stream.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>
    </div>`;
  }
  return `<div class="panel panel--stream panel--stream-off">
    <h2>Livestream</h2>
    <p class="panel__lead">${escapeHtml(stream.note || 'Livestream not on air for this regatta yet.')}</p>
    <button type="button" class="btn btn--ghost" disabled aria-disabled="true">${escapeHtml(label)} · soon</button>
  </div>`;
}

function logoHtml(url, code, extraClass = '') {
  const fallback = escapeHtml((code || '?').slice(0, 3));
  const cls = extraClass ? `logo ${extraClass}` : 'logo';
  if (url) {
    return `<img class="${cls}" src="${escapeHtml(url)}" data-logo-src="${escapeHtml(url)}" alt="" loading="lazy" data-fallback="${fallback}" />`;
  }
  return `<span class="${cls} logo--empty" aria-hidden="true">${fallback}</span>`;
}

function badgeForStatus(status) {
  if (status === 'start_blocks') {
    return '<span class="heat__badge heat__badge--blocks">Start blocks</span>';
  }
  if (status === 'live') {
    return '<span class="heat__badge heat__badge--live">Live</span>';
  }
  if (status === 'finished') {
    return '<span class="heat__badge heat__badge--done">Finished</span>';
  }
  if (status === 'result' || status === 'done') {
    return '<span class="heat__badge heat__badge--done">Result</span>';
  }
  return '<span class="heat__badge">Upcoming</span>';
}

function renderDrawOrResults(race, phase) {
  const showResults =
    race.result?.placings?.length &&
    (phase.status === 'finished' ||
      phase.status === 'result' ||
      phase.status === 'done');
  if (showResults) {
    return `<div class="lanes">
      ${race.result.placings
        .map((p) => {
          const place = p.place >= 90 ? '—' : p.place;
          return `<div class="lane">
            <span class="lane__n">${place}</span>
            ${logoHtml(p.logoUrl, p.clubCode)}
            <div class="lane__crew">${escapeHtml(p.competitor)}
              <small>${escapeHtml(p.time || '')}</small>
            </div>
          </div>`;
        })
        .join('')}
    </div>`;
  }
  const clubSet = new Set(state.follows.clubs);
  return `<div class="lanes">
    ${race.lanes
      .map((l) => {
        const followed = clubSet.has(l.clubId);
        return `<div class="lane ${followed ? 'is-followed' : ''}">
          <span class="lane__n">${l.lane}</span>
          ${logoHtml(l.logoUrl, l.clubCode)}
          <div class="lane__crew">${escapeHtml(l.entry)}
            <small>${escapeHtml(l.clubName || '')}${followed ? ' · Following' : ''}</small>
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

function renderExpandableRace(race, phase, { showDay } = {}) {
  const open = state.expanded.has(race.id);
  const dayBit = showDay ? ` · Day ${race.dayIndex}` : '';
  return `<article class="race-card race-card--${phase.status}">
    <button type="button" class="race-card__head" data-expand="${escapeHtml(race.id)}" aria-expanded="${open}">
      <div class="race-card__top">
        <span class="heat__time">${escapeHtml(race.time)}</span>
        ${badgeForStatus(phase.status)}
      </div>
      <p class="heat__event">${escapeHtml(race.key)} · ${escapeHtml(race.eventType)}${dayBit}</p>
      <p class="heat__who">${escapeHtml(race.round)} ${escapeHtml(race.division)} · tap to ${open ? 'hide' : 'expand'}</p>
    </button>
    ${
      open
        ? `<div class="race-card__body">
      ${renderDrawOrResults(race, phase)}
      ${
        phase.status === 'live' && race.isDemoLive
          ? `<button type="button" class="btn btn--live" style="margin-top:10px" data-go="live">Watch live track</button>`
          : ''
      }
    </div>`
        : ''
    }
  </article>`;
}

function homeBuckets() {
  const now = nowMs();
  const buckets = { start_blocks: [], live: [], finished: [] };
  for (const race of state.data.races) {
    const phase = racePhase(now, race);
    if (phase.status === 'start_blocks') buckets.start_blocks.push({ race, phase });
    else if (phase.status === 'live') buckets.live.push({ race, phase });
    else if (phase.status === 'finished') buckets.finished.push({ race, phase });
  }
  const byTime = (a, b) => (a.race.startMsOfDay || 0) - (b.race.startMsOfDay || 0);
  buckets.start_blocks.sort(byTime);
  buckets.live.sort(byTime);
  buckets.finished.sort(byTime);
  return buckets;
}

function renderClockBar() {
  const clock = formatMsOfDay(nowMs());
  const usingDevice = state.clockOverrideMs == null;
  return `<div class="clock-bar panel">
    <div class="clock-bar__row">
      <span class="clock-bar__label">Demo clock</span>
      <strong class="clock-bar__time">${clock}</strong>
    </div>
    <p class="panel__lead" style="margin-bottom:10px">Uses time of day against the daysheet. Override to scrub the sample day.</p>
    <div class="chip-row">
      <button type="button" class="chip ${usingDevice ? 'is-on' : ''}" data-clock="device">Device time</button>
      <button type="button" class="chip" data-clock="0830">08:30</button>
      <button type="button" class="chip" data-clock="1020">10:20</button>
      <button type="button" class="chip" data-clock="1400">14:00</button>
    </div>
  </div>`;
}

function renderBucket(title, items, empty) {
  if (!items.length) {
    return `<div class="panel panel--tight">
      <h2>${escapeHtml(title)}</h2>
      <p class="empty empty--sm">${escapeHtml(empty)}</p>
    </div>`;
  }
  return `<div class="panel panel--tight">
    <h2>${escapeHtml(title)} <span class="count">${items.length}</span></h2>
    <div class="race-list">
      ${items.map(({ race, phase }) => renderExpandableRace(race, phase)).join('')}
    </div>
  </div>`;
}

function renderHome() {
  const buckets = homeBuckets();
  const followCount = state.follows.clubs.length + state.follows.athletes.length;
  return `
    <section class="hero hero--compact">
      <h1>Follow the racing</h1>
    </section>
    ${renderClockBar()}
    ${renderBucket('In the start blocks', buckets.start_blocks, 'No races in the next 10 minutes')}
    ${renderBucket('Live on course', buckets.live, 'No race on the water right now')}
    ${renderBucket('Just finished', buckets.finished, 'No new results in the last 10 minutes')}
    ${renderLivestreamCard()}
    <div class="panel">
      <div class="chip-row" style="margin-bottom:12px">
        <span class="chip is-on">${followCount ? `${followCount} following` : 'Nothing followed yet'}</span>
      </div>
      <button type="button" class="btn btn--primary" data-go="follow">Follow a club or athlete</button>
      <div style="height:8px"></div>
      <button type="button" class="btn btn--ghost" data-go="schedule">Full schedule</button>
    </div>
  `;
}

function renderSchedule() {
  const days = state.data.days;
  if (!days.length) {
    return `<div class="panel"><p class="empty">No daysheet</p></div>`;
  }
  if (!days.some((d) => d.index === state.scheduleDayIndex)) {
    state.scheduleDayIndex = days[0].index;
  }
  const day = days.find((d) => d.index === state.scheduleDayIndex) || days[0];
  const now = nowMs();
  return `
    <div class="panel">
      <h2>Schedule</h2>
      <p class="panel__lead">${escapeHtml(state.data.meta.name)}</p>
      <div class="chip-row" style="margin-bottom:12px">
        ${days
          .map(
            (d) =>
              `<button type="button" class="chip ${d.index === state.scheduleDayIndex ? 'is-on' : ''}" data-day="${d.index}">Day ${d.index}</button>`,
          )
          .join('')}
      </div>
      <p class="muted" style="margin:0 0 8px">${escapeHtml(day.label)} · ${day.races.length} races</p>
      ${renderClockBar()}
      <div class="race-list">
        ${day.races
          .map((race) => {
            const phase = racePhase(now, race);
            return renderExpandableRace(race, phase);
          })
          .join('')}
      </div>
    </div>`;
}

function renderFollow() {
  const q = state.search.trim().toLowerCase();
  const clubs = state.data.clubs.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
  );
  const athletes = state.data.athletes.filter((a) => !q || a.name.toLowerCase().includes(q));

  const list =
    state.followMode === 'club'
      ? clubs
          .slice(0, 80)
          .map(
            (c) => `<button type="button" class="list-item" data-toggle-club="${escapeHtml(c.id)}">
          ${logoHtml(c.logo, c.code)}
          <span class="list-item__meta">
            <strong>${escapeHtml(c.name)}</strong>
            <span>${escapeHtml(c.code)} · ${c.raceCount} race${c.raceCount === 1 ? '' : 's'}</span>
          </span>
          <span class="list-item__action">${isFollowingClub(c.id) ? 'Following' : 'Follow'}</span>
        </button>`,
          )
          .join('')
      : athletes
          .slice(0, 80)
          .map(
            (a) => `<button type="button" class="list-item" data-toggle-athlete="${escapeHtml(a.name)}">
          <span class="list-item__code">ATH</span>
          <span class="list-item__meta">
            <strong>${escapeHtml(a.name)}</strong>
            <span>${a.raceIds.length} race${a.raceIds.length === 1 ? '' : 's'}</span>
          </span>
          <span class="list-item__action">${isFollowingAthlete(a.name) ? 'Following' : 'Follow'}</span>
        </button>`,
          )
          .join('');

  return `
    <div class="panel">
      <h2>Follow</h2>
      <p class="panel__lead">Saved on this phone for My day and lane highlights.</p>
      <div class="chip-row" style="margin-bottom:12px">
        <button type="button" class="chip ${state.followMode === 'club' ? 'is-on' : ''}" data-mode="club">Club / school</button>
        <button type="button" class="chip ${state.followMode === 'athlete' ? 'is-on' : ''}" data-mode="athlete">Athlete</button>
      </div>
      <input class="search" id="followSearch" type="search" placeholder="Search…" value="${escapeHtml(state.search)}" />
      <div class="list">${list || '<p class="empty">No matches</p>'}</div>
    </div>
  `;
}

function renderMyDay() {
  if (state.selectedRaceId) {
    return renderRaceDetail(state.selectedRaceId);
  }
  const items = racesForFollows();
  if (!items.length) {
    return `
      <div class="panel">
        <h2>My day</h2>
        <p class="empty">Follow a club or athlete to see their heats here.</p>
        <button type="button" class="btn btn--primary" data-go="follow">Find someone to follow</button>
      </div>`;
  }
  const now = nowMs();
  return `
    <div class="panel">
      <h2>My day</h2>
      <p class="panel__lead">Heats that include someone you follow.</p>
      <div class="race-list">
        ${items
          .map(({ race }) => {
            const phase = racePhase(now, race);
            return renderExpandableRace(race, phase, { showDay: true });
          })
          .join('')}
      </div>
    </div>`;
}

function renderRaceDetail(id) {
  const race = state.data.raceById.get(id);
  if (!race) return `<div class="panel"><p class="empty">Race not found</p></div>`;
  const phase = racePhase(nowMs(), race);
  return `
    <div class="panel">
      <h2>${escapeHtml(race.eventType)}</h2>
      <p class="panel__lead">${escapeHtml(race.key)} · ${escapeHtml(race.time)} · Day ${race.dayIndex} · ${escapeHtml(phase.label)}</p>
      ${renderDrawOrResults(race, phase)}
      ${
        phase.status === 'live' && race.isDemoLive
          ? `<div style="height:12px"></div><button type="button" class="btn btn--live" data-go="live">Watch live track</button>`
          : ''
      }
    </div>`;
}

function renderLive() {
  return `
    <div class="live-shell">
      ${renderLivestreamCard()}
      <div class="panel" style="padding:12px">
        <div class="live-status">
          <span><span class="live-status__dot" id="liveDot"></span><span id="liveStatusText">Connecting…</span></span>
          <span id="liveMeta" class="muted"></span>
        </div>
      </div>
      <div class="course-wrap course-wrap--tall">
        <canvas id="courseCanvas" width="360" height="560" aria-label="Live course"></canvas>
      </div>
      <div class="panel" id="unofficialPanel" hidden>
        <h2>Unofficial results</h2>
        <p class="panel__lead">Based on CV tracking — not official RowIT results.</p>
        <div class="order" id="orderList"></div>
      </div>
    </div>`;
}

function render() {
  stopHomeTimer();
  btnBack.hidden = !(state.tab === 'myday' && state.selectedRaceId);
  btnLiveJump.hidden = state.tab === 'live';
  topSub.textContent = state.data?.meta?.name || 'Regatta NZ';

  if (state.tab === 'home') main.innerHTML = renderHome();
  else if (state.tab === 'schedule') main.innerHTML = renderSchedule();
  else if (state.tab === 'follow') main.innerHTML = renderFollow();
  else if (state.tab === 'myday') main.innerHTML = renderMyDay();
  else if (state.tab === 'live') {
    main.innerHTML = renderLive();
    startLive();
  }

  if (state.tab === 'home' || state.tab === 'schedule' || state.tab === 'myday') {
    if (state.clockOverrideMs == null) {
      state.homeTimer = setInterval(() => {
        if (state.tab === 'home' || state.tab === 'schedule' || state.tab === 'myday') {
          render();
        }
      }, 30000);
    }
  }

  wireDom();
}

function setClockPreset(key) {
  if (key === 'device') {
    state.clockOverrideMs = null;
  } else if (/^\d{4}$/.test(key)) {
    const h = Number(key.slice(0, 2));
    const m = Number(key.slice(2));
    state.clockOverrideMs = (h * 60 + m) * 60 * 1000;
  }
  saveClockOverride();
  render();
}

function wireDom() {
  main.querySelector('[data-go="follow"]')?.addEventListener('click', () => setTab('follow'));
  main.querySelector('[data-go="live"]')?.addEventListener('click', () => setTab('live'));
  main.querySelector('[data-go="schedule"]')?.addEventListener('click', () => setTab('schedule'));

  for (const img of main.querySelectorAll('img.logo[data-fallback]')) {
    img.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = 'logo logo--empty';
      span.textContent = img.dataset.fallback || '?';
      span.setAttribute('aria-hidden', 'true');
      img.replaceWith(span);
    });
  }
  enhanceLogoImages(main);

  for (const el of main.querySelectorAll('[data-clock]')) {
    el.addEventListener('click', () => setClockPreset(el.dataset.clock));
  }
  for (const el of main.querySelectorAll('[data-day]')) {
    el.addEventListener('click', () => {
      state.scheduleDayIndex = Number(el.dataset.day);
      render();
    });
  }
  for (const el of main.querySelectorAll('[data-expand]')) {
    el.addEventListener('click', () => {
      const id = el.dataset.expand;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      render();
    });
  }

  main.querySelector('#followSearch')?.addEventListener('input', (e) => {
    state.search = e.target.value;
    main.innerHTML = renderFollow();
    const input = main.querySelector('#followSearch');
    if (input) {
      input.focus();
      input.setSelectionRange(state.search.length, state.search.length);
    }
    wireDom();
  });
  for (const el of main.querySelectorAll('[data-mode]')) {
    el.addEventListener('click', () => {
      state.followMode = el.dataset.mode;
      render();
    });
  }
  for (const el of main.querySelectorAll('[data-toggle-club]')) {
    el.addEventListener('click', () => toggleClub(el.dataset.toggleClub));
  }
  for (const el of main.querySelectorAll('[data-toggle-athlete]')) {
    el.addEventListener('click', () => toggleAthlete(el.dataset.toggleAthlete));
  }
}

async function tickLive() {
  const demo = state.data.raceByKey.get(REGATTA.demoLiveRaceKey);
  const dot = document.getElementById('liveDot');
  const status = document.getElementById('liveStatusText');
  const meta = document.getElementById('liveMeta');
  const order = document.getElementById('orderList');
  const unofficialPanel = document.getElementById('unofficialPanel');
  const canvas = document.getElementById('courseCanvas');
  if (!canvas) return;

  if (!state.liveCourse) {
    state.liveCourse = createLiveCourse(canvas);
    canvas.addEventListener('logo-ready', () => {
      if (state.lastRaceSnap) state.liveCourse.paint(state.lastRaceSnap);
    });
  }
  state.liveCourse.setLaneLabels(laneLabelMap(demo));
  state.liveCourse.setFollowedLane(followedLaneForRace(demo));

  try {
    const spectator = state.data?.spectator || {};
    const snap = await fetchRaceSnapshot('', {
      mode: spectator.mode || state.data?.meta?.feedMode || 'sim',
      streamId: spectator.streamId || state.data?.meta?.streamId || 'ged-sim',
    });
    const painted = {
      ...snap,
      eventType: demo?.eventType || snap.eventType,
      race: demo?.key || snap.race,
    };
    state.lastRaceSnap = painted;
    state.liveCourse.paint(painted);
    const finished = String(snap.race_phase || '') === 'finished';
    if (dot) dot.classList.toggle('is-on', !snap.stale);
    const feedMode = state.data?.spectator?.mode || state.data?.meta?.feedMode || 'sim';
    if (status) {
      const simTag =
        feedMode === 'sim' || snap.sim
          ? feedMode === 'live' && snap.sim
            ? ' · waiting for live feed'
            : ' (sim)'
          : '';
      status.textContent = finished
        ? `Finished · unofficial CV${simTag}`
        : `Live · ${snap.race_phase || 'racing'}${simTag}`;
    }
    if (meta) {
      const ch = Number(snap.leader_chainage_m);
      meta.textContent = finished
        ? 'Results pending RowIT'
        : Number.isFinite(ch)
          ? `${Math.round(ch)} m`
          : '';
    }
    if (unofficialPanel && order) {
      if (finished) {
        unofficialPanel.hidden = false;
        const rows = unofficialPlacings(snap, laneLabelMap(demo));
        order.innerHTML = rows
          .map((r) => {
            const fol =
              followedLaneForRace(demo) === r.lane ? ' order__row--followed' : '';
            const lead = r.place === 1 ? ' order__row--lead' : '';
            return `<div class="order__row${lead}${fol}">
              <span class="order__rank">${r.place}</span>
              ${logoHtml(r.logoUrl, r.code, 'logo--live')}
              <span class="order__name">Ln ${r.lane} · ${escapeHtml(r.code)}</span>
              <span class="order__gap">${escapeHtml(r.time || '—')}</span>
            </div>`;
          })
          .join('');
        for (const img of order.querySelectorAll('img.logo[data-fallback]')) {
          img.addEventListener('error', () => {
            const span = document.createElement('span');
            span.className = 'logo logo--empty logo--live';
            span.textContent = img.dataset.fallback || '?';
            span.setAttribute('aria-hidden', 'true');
            img.replaceWith(span);
          });
        }
        enhanceLogoImages(order);
      } else {
        unofficialPanel.hidden = true;
        order.innerHTML = '';
      }
    }
  } catch (err) {
    state.liveError = err;
    if (dot) dot.classList.remove('is-on');
    if (status) {
      status.textContent =
        (state.data?.spectator?.mode || 'sim') === 'live'
          ? 'Live race API offline'
          : 'Sim API offline — start local server / vercel dev';
    }
    if (unofficialPanel) {
      unofficialPanel.hidden = false;
      if (order) {
        order.innerHTML =
          '<p class="muted">Run <code>node server.js</code>, then open <code>http://localhost:3000/regatta-nz/</code>.</p>';
      }
    }
  }
}

function startLive() {
  stopLive();
  state.liveCourse = null;
  tickLive();
  state.liveTimer = setInterval(tickLive, 250);
}

tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  setTab(btn.dataset.tab);
});

btnBack.addEventListener('click', () => {
  state.selectedRaceId = null;
  render();
});

btnLiveJump.addEventListener('click', () => setTab('live'));

async function boot() {
  main.innerHTML = `<div class="panel"><p class="muted">Loading NZ Masters sample…</p></div>`;
  try {
    const loaded = loadRegatta();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Load timed out (15s)')), 15000),
    );
    state.data = await Promise.race([loaded, timeout]);
    if (state.data.days[0]) state.scheduleDayIndex = state.data.days[0].index;
    const tod = msOfDayFromDate();
    const first = state.data.races.find((r) => Number.isFinite(r.startMsOfDay));
    const last = [...state.data.races].reverse().find((r) => Number.isFinite(r.startMsOfDay));
    if (
      state.clockOverrideMs == null &&
      first &&
      last &&
      (tod < first.startMsOfDay - REGATTA.startBlocksMs ||
        tod > last.startMsOfDay + REGATTA.defaultRaceMs + REGATTA.finishedWindowMs)
    ) {
      state.clockOverrideMs = (8 * 60 + 40) * 60 * 1000;
    }
    render();
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="panel"><p class="empty">Could not load sample data.<br>${escapeHtml(err.message)}</p></div>`;
  }
}

boot();
