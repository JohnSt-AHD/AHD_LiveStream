import {
  loadRegatta,
  REGATTA,
  racePhase,
  msOfDayFromDate,
  AGE_GROUP_OPTIONS,
  GENDER_OPTIONS,
} from './data.js?v=27';
import { createLiveCourse, fetchRaceSnapshot, unofficialPlacings } from './live-course.js?v=27';
import { enhanceLogoImages } from './logo-cutout.js?v=27';
import {
  loadNotifyPrefs,
  saveNotifyPrefs,
  requestNotifyPermission,
  cancelScheduledNotifications,
  scheduleFollowedRaceNotifications,
  maybeWebNotifyRace,
  NOTIFY_BEFORE_MS,
} from './notify.js?v=27';

const LS_FOLLOWS = 'regattaNzFollows_v1';

const state = {
  data: null,
  tab: 'home',
  followMode: 'club',
  search: '',
  /** @type {null | { athleteName: string, selected: Set<string> }} */
  crewPick: null,
  selectedRaceId: null,
  follows: loadFollows(),
  notify: loadNotifyPrefs(),
  liveTimer: null,
  homeTimer: null,
  countdownTimer: null,
  liveCourse: null,
  liveError: null,
  lastRaceSnap: null,
  expanded: new Set(),
  scheduleDayIndex: 1,
  notifySyncTimer: null,
};

const main = document.getElementById('main');
const topSub = document.getElementById('topSub');
const btnBack = document.getElementById('btnBack');
const btnLiveJump = document.getElementById('btnLiveJump');
const tabbar = document.getElementById('tabbar');

function normalizeCrewFollow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  return {
    id,
    label: String(raw.label || id),
    raceId: raw.raceId ? String(raw.raceId) : '',
    raceKey: raw.raceKey ? String(raw.raceKey) : '',
    lane: Number.isFinite(Number(raw.lane)) ? Number(raw.lane) : null,
    clubId: raw.clubId ? String(raw.clubId) : '',
    athleteName: raw.athleteName ? String(raw.athleteName) : '',
  };
}

function loadFollows() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_FOLLOWS) || '{}');
    const crews = Array.isArray(raw.crews)
      ? raw.crews.map(normalizeCrewFollow).filter(Boolean)
      : [];
    return {
      clubs: Array.isArray(raw.clubs) ? raw.clubs : [],
      athletes: Array.isArray(raw.athletes) ? raw.athletes : [],
      ageGroups: Array.isArray(raw.ageGroups) ? raw.ageGroups : [],
      genders: Array.isArray(raw.genders) ? raw.genders : [],
      crews,
    };
  } catch {
    return { clubs: [], athletes: [], ageGroups: [], genders: [], crews: [] };
  }
}

function saveFollows() {
  localStorage.setItem(LS_FOLLOWS, JSON.stringify(state.follows));
  queueNotifySync();
}

function followCount() {
  const f = state.follows;
  return (
    f.clubs.length +
    f.athletes.length +
    f.ageGroups.length +
    f.genders.length +
    f.crews.length
  );
}

function hasAnyFollows() {
  return followCount() > 0;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nowMs() {
  return msOfDayFromDate();
}

function setTab(tab) {
  state.tab = tab;
  state.selectedRaceId = null;
  if (tab !== 'follow') state.crewPick = null;
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

function stopCountdownTimer() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

function matchesAgeGender(race) {
  const ages = state.follows.ageGroups;
  const genders = state.follows.genders;
  if (!ages.length && !genders.length) return false;
  const ageOk = !ages.length || (race.ageGroup && ages.includes(race.ageGroup));
  const genderOk = !genders.length || (race.gender && genders.includes(race.gender));
  // Age groups + optional gender filter; genders alone also match.
  if (ages.length && genders.length) return ageOk && genderOk;
  if (ages.length) return ageOk;
  return genderOk;
}

function racesForFollows() {
  const { races } = state.data;
  const clubSet = new Set(state.follows.clubs);
  const athleteSet = new Set(state.follows.athletes.map((n) => n.toLowerCase()));
  const crewByRace = new Map();
  for (const c of state.follows.crews) {
    const key = c.raceId || c.raceKey;
    if (!key) continue;
    if (!crewByRace.has(key)) crewByRace.set(key, []);
    crewByRace.get(key).push(c);
  }
  const out = [];
  for (const race of races) {
    const matchedLanes = race.lanes.filter((l) => clubSet.has(l.clubId));
    const matchedAthletes = race.athletes.filter((n) => athleteSet.has(n.toLowerCase()));
    const matchedCrews = [
      ...(crewByRace.get(race.id) || []),
      ...(crewByRace.get(race.key) || []),
    ].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
    const crewLanes = matchedCrews
      .map((c) => race.lanes.find((l) => l.lane === c.lane))
      .filter(Boolean);
    for (const lane of crewLanes) {
      if (!matchedLanes.some((l) => l.lane === lane.lane)) matchedLanes.push(lane);
    }
    const ageGender = matchesAgeGender(race);
    if (!matchedLanes.length && !matchedAthletes.length && !matchedCrews.length && !ageGender) {
      continue;
    }
    const bits = [];
    if (matchedCrews.length) {
      bits.push(matchedCrews.map((c) => c.label).filter(Boolean).slice(0, 2).join(', '));
    }
    if (matchedLanes.length && !matchedCrews.length) {
      bits.push(matchedLanes.map((l) => l.clubCode).filter(Boolean).slice(0, 2).join(', '));
    }
    if (matchedAthletes.length) bits.push(matchedAthletes.slice(0, 2).join(', '));
    if (ageGender) {
      const g = GENDER_OPTIONS.find((o) => o.id === race.gender)?.label || race.gender;
      bits.push([race.ageGroup, g].filter(Boolean).join(' · '));
    }
    out.push({
      race,
      matchedLanes,
      matchedAthletes,
      matchedCrews,
      ageGender,
      matchLabel: bits.filter(Boolean).join(' · ') || 'Follow',
    });
  }
  return out;
}

/** Soonest followed race that has not finished yet. */
function nextFollowedRaceItem() {
  const now = nowMs();
  let best = null;
  for (const item of racesForFollows()) {
    const start = item.race.startMsOfDay;
    if (!Number.isFinite(start)) continue;
    const finish = start + (item.race.raceDurationMs || REGATTA.defaultRaceMs);
    if (now >= finish) continue;
    if (!best || start < best.race.startMsOfDay) best = item;
  }
  return best;
}

function formatCountdown(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function countdownCopy(race) {
  const now = nowMs();
  const start = race.startMsOfDay;
  const finish = start + (race.raceDurationMs || REGATTA.defaultRaceMs);
  const phase = racePhase(now, race);
  if (phase.status === 'live' || (now >= start && now < finish)) {
    return {
      label: 'Racing now',
      detail: formatCountdown(finish - now) + ' left on course',
      urgent: true,
    };
  }
  if (phase.status === 'start_blocks' || (now >= start - NOTIFY_BEFORE_MS && now < start)) {
    return {
      label: 'In the start blocks',
      detail: `Starts in ${formatCountdown(start - now)}`,
      urgent: true,
    };
  }
  return {
    label: 'Next followed race',
    detail: `Starts in ${formatCountdown(start - now)}`,
    urgent: false,
  };
}

function isFollowingAgeGroup(id) {
  return state.follows.ageGroups.includes(id);
}

function isFollowingGender(id) {
  return state.follows.genders.includes(id);
}

function toggleAgeGroup(id) {
  if (isFollowingAgeGroup(id)) {
    state.follows.ageGroups = state.follows.ageGroups.filter((a) => a !== id);
  } else {
    state.follows.ageGroups = [...state.follows.ageGroups, id];
  }
  saveFollows();
  render();
}

function toggleGender(id) {
  if (isFollowingGender(id)) {
    state.follows.genders = state.follows.genders.filter((g) => g !== id);
  } else {
    state.follows.genders = [...state.follows.genders, id];
  }
  saveFollows();
  render();
}

let notifySyncQueued = null;
function queueNotifySync() {
  if (notifySyncQueued) clearTimeout(notifySyncQueued);
  notifySyncQueued = setTimeout(() => {
    notifySyncQueued = null;
    syncNotifications();
  }, 400);
}

async function syncNotifications() {
  if (!state.data) return;
  const items = racesForFollows();
  if (!state.notify.enabled) {
    await cancelScheduledNotifications();
    return;
  }
  await scheduleFollowedRaceNotifications(items);
  // Web mirror for races currently in start blocks / live
  const now = nowMs();
  for (const item of items) {
    const phase = racePhase(now, item.race);
    maybeWebNotifyRace(item.race, phase.status, item.matchLabel);
  }
}

async function setNotificationsEnabled(on) {
  if (on) {
    const ok = await requestNotifyPermission();
    if (!ok) {
      const webDenied =
        typeof Notification !== 'undefined' && Notification.permission === 'denied';
      const nativeDenied = Boolean(window.Capacitor?.isNativePlatform?.());
      if (webDenied || nativeDenied) {
        state.notify = { enabled: false };
        saveNotifyPrefs(state.notify);
        render();
        return;
      }
    }
  }
  state.notify = { enabled: Boolean(on) };
  saveNotifyPrefs(state.notify);
  if (!on) await cancelScheduledNotifications();
  else await syncNotifications();
  render();
}

function isFollowingClub(id) {
  return state.follows.clubs.includes(id);
}

function isFollowingAthlete(name) {
  return state.follows.athletes.some((n) => n.toLowerCase() === name.toLowerCase());
}

function isFollowingCrew(id) {
  return state.follows.crews.some((c) => c.id === id);
}

function athleteHasFollowedCrew(athlete) {
  if (!athlete?.crews?.length) return false;
  return athlete.crews.some((c) => isFollowingCrew(c.id));
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

function openCrewPick(athleteName) {
  const athlete = state.data.athletes.find(
    (a) => a.name.toLowerCase() === athleteName.toLowerCase(),
  );
  if (!athlete) return;
  const selected = new Set(
    (athlete.crews || []).filter((c) => isFollowingCrew(c.id)).map((c) => c.id),
  );
  state.crewPick = { athleteName: athlete.name, selected };
  render();
}

function closeCrewPick() {
  state.crewPick = null;
  render();
}

function toggleCrewPickId(id) {
  if (!state.crewPick) return;
  if (state.crewPick.selected.has(id)) state.crewPick.selected.delete(id);
  else state.crewPick.selected.add(id);
  render();
}

function confirmCrewPick() {
  if (!state.crewPick) return;
  const athlete = state.data.athletes.find(
    (a) => a.name.toLowerCase() === state.crewPick.athleteName.toLowerCase(),
  );
  if (!athlete) {
    closeCrewPick();
    return;
  }
  const athleteCrewIds = new Set((athlete.crews || []).map((c) => c.id));
  // Drop this athlete's previous crew follows, then add confirmed selection
  state.follows.crews = state.follows.crews.filter((c) => !athleteCrewIds.has(c.id));
  for (const crew of athlete.crews || []) {
    if (!state.crewPick.selected.has(crew.id)) continue;
    state.follows.crews.push({
      id: crew.id,
      label: crew.label,
      raceId: crew.raceId,
      raceKey: crew.raceKey,
      lane: crew.lane,
      clubId: crew.clubId || '',
      athleteName: athlete.name,
    });
  }
  // Legacy name-only follows: remove so My day uses confirmed crews
  state.follows.athletes = state.follows.athletes.filter(
    (n) => n.toLowerCase() !== athlete.name.toLowerCase(),
  );
  state.crewPick = null;
  saveFollows();
  render();
}

function removeCrewFollow(id) {
  state.follows.crews = state.follows.crews.filter((c) => c.id !== id);
  saveFollows();
  render();
}

function followedLaneForRace(race) {
  if (!race) return null;
  const crewHit = state.follows.crews.find(
    (c) => (c.raceId === race.id || c.raceKey === race.key) && c.lane != null,
  );
  if (crewHit) return crewHit.lane;
  const clubSet = new Set(state.follows.clubs);
  const hit = race.lanes.find((l) => clubSet.has(l.clubId));
  if (hit) return hit.lane;
  if (matchesAgeGender(race) && race.lanes[0]) return race.lanes[0].lane;
  return null;
}

function laneIsFollowed(lane, race) {
  if (
    state.follows.crews.some(
      (c) =>
        (c.raceId === race.id || c.raceKey === race.key) && Number(c.lane) === Number(lane.lane),
    )
  ) {
    return true;
  }
  if (state.follows.clubs.includes(lane.clubId)) return true;
  if (matchesAgeGender(race)) return true;
  return false;
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
  return `<div class="lanes">
    ${race.lanes
      .map((l) => {
        const followed = laneIsFollowed(l, race);
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
  const n = followCount();
  return `
    <section class="hero hero--compact">
      <h1>Follow the racing</h1>
    </section>
    ${renderBucket('In the start blocks', buckets.start_blocks, 'No races in the next 10 minutes')}
    ${renderBucket('Live on course', buckets.live, 'No race on the water right now')}
    ${renderBucket('Just finished', buckets.finished, 'No new results in the last 10 minutes')}
    ${renderLivestreamCard()}
    <div class="panel">
      <div class="chip-row" style="margin-bottom:12px">
        <span class="chip is-on">${n ? `${n} following` : 'Nothing followed yet'}</span>
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

function renderNotifySettings() {
  const on = state.notify.enabled;
  const mins = Math.round(NOTIFY_BEFORE_MS / 60000);
  return `
    <div class="panel panel--settings">
      <h2>Notifications</h2>
      <p class="panel__lead">Alert ~${mins} min before a followed crew races. Scheduled on this device from the daysheet (works offline once loaded). Native APK preferred.</p>
      <label class="toggle">
        <input type="checkbox" id="notifyToggle" ${on ? 'checked' : ''} />
        <span class="toggle__ui" aria-hidden="true"></span>
        <span class="toggle__label">${on ? 'On' : 'Off'}</span>
      </label>
    </div>`;
}

function renderCrewConfirm(athlete) {
  const pick = state.crewPick;
  if (!pick || !athlete) return '';
  const crews = athlete.crews || [];
  if (!crews.length) {
    return `
      <div class="crew-confirm" id="crewConfirm">
        <p class="crew-confirm__title">Confirm crews for ${escapeHtml(athlete.name)}</p>
        <p class="empty">No crew entries found for this athlete in the current draw.</p>
        <button type="button" class="btn btn--ghost" data-crew-cancel>Close</button>
      </div>`;
  }
  return `
    <div class="crew-confirm" id="crewConfirm">
      <p class="crew-confirm__title">Confirm crews for ${escapeHtml(athlete.name)}</p>
      <p class="muted" style="margin:0 0 10px">Tick the boat(s) to follow, then add. Allocation may change if entries change.</p>
      <div class="crew-confirm__list">
        ${crews
          .map((c) => {
            const on = pick.selected.has(c.id);
            const detail = [c.time, c.eventType, c.lane != null ? `Lane ${c.lane}` : '']
              .filter(Boolean)
              .join(' · ');
            return `<label class="crew-check ${on ? 'is-on' : ''}">
              <input type="checkbox" data-crew-toggle="${escapeHtml(c.id)}" ${on ? 'checked' : ''} />
              <span class="crew-check__body">
                <strong>${escapeHtml(c.label)}</strong>
                <span>${escapeHtml(detail)}</span>
              </span>
            </label>`;
          })
          .join('')}
      </div>
      <div class="crew-confirm__actions">
        <button type="button" class="btn btn--ghost" data-crew-cancel>Cancel</button>
        <button type="button" class="btn btn--primary" data-crew-confirm>
          ${pick.selected.size ? `Add ${pick.selected.size} crew${pick.selected.size === 1 ? '' : 's'}` : 'Clear crews'}
        </button>
      </div>
    </div>`;
}

function renderFollow() {
  const q = state.search.trim().toLowerCase();
  const clubs = state.data.clubs.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
  );
  const athletes = state.data.athletes.filter((a) => !q || a.name.toLowerCase().includes(q));
  const pickAthlete =
    state.crewPick &&
    state.data.athletes.find(
      (a) => a.name.toLowerCase() === state.crewPick.athleteName.toLowerCase(),
    );

  const followedCrewChips =
    state.follows.crews.length > 0
      ? `<div class="follow-section">
        <p class="follow-section__title">Following crews</p>
        <div class="chip-row">
          ${state.follows.crews
            .map(
              (c) =>
                `<button type="button" class="chip is-on" data-remove-crew="${escapeHtml(c.id)}" title="Unfollow">${escapeHtml(c.label)} ×</button>`,
            )
            .join('')}
        </div>
      </div>`
      : '';

  const list =
    state.followMode === 'club'
      ? clubs
          .slice(0, 80)
          .map(
            (c) => `<button type="button" class="list-item" data-toggle-club="${escapeHtml(c.id)}">
          ${logoHtml(c.logo, c.code)}
          <span class="list-item__meta">
            <strong>${escapeHtml(c.name)}</strong>
            <span>${escapeHtml(c.code)} · all crews · ${c.raceCount} race${c.raceCount === 1 ? '' : 's'}</span>
          </span>
          <span class="list-item__action">${isFollowingClub(c.id) ? 'Following' : 'Follow'}</span>
        </button>`,
          )
          .join('')
      : athletes
          .slice(0, 80)
          .map((a) => {
            const crewLabels = (a.crews || [])
              .map((c) => c.label)
              .filter(Boolean)
              .slice(0, 4);
            const following = athleteHasFollowedCrew(a) || isFollowingAthlete(a.name);
            const picking =
              state.crewPick &&
              state.crewPick.athleteName.toLowerCase() === a.name.toLowerCase();
            return `<button type="button" class="list-item ${picking ? 'is-active' : ''}" data-pick-athlete="${escapeHtml(a.name)}">
          <span class="list-item__code">ATH</span>
          <span class="list-item__meta">
            <strong>${escapeHtml(a.name)}</strong>
            <span>${crewLabels.length ? escapeHtml(crewLabels.join(' · ')) : `${a.raceIds.length} race${a.raceIds.length === 1 ? '' : 's'}`}</span>
          </span>
          <span class="list-item__action">${following ? 'Following' : 'Choose'}</span>
        </button>`;
          })
          .join('');

  const athleteNote =
    state.followMode === 'athlete'
      ? `<p class="follow-note">Crew allocation is estimated from the published draw and <strong>may be wrong if entries change</strong>. Confirm which boat(s) to follow.</p>`
      : '';

  return `
    <div class="panel">
      <h2>Follow</h2>
      <p class="panel__lead">Clubs include every crew from that club. Athletes let you confirm specific boats. Age groups and gender combine as a filter. Saved on this phone for My day, alerts, and lane highlights.</p>
      ${followedCrewChips}
      <div class="follow-section">
        <p class="follow-section__title">Age groups</p>
        <div class="chip-row">
          ${AGE_GROUP_OPTIONS.map(
            (o) =>
              `<button type="button" class="chip ${isFollowingAgeGroup(o.id) ? 'is-on' : ''}" data-toggle-age="${escapeHtml(o.id)}">${escapeHtml(o.label)}</button>`,
          ).join('')}
        </div>
      </div>
      <div class="follow-section">
        <p class="follow-section__title">Gender</p>
        <p class="muted" style="margin:0 0 8px">Optional filter on age-group follows (or follow gender alone).</p>
        <div class="chip-row">
          ${GENDER_OPTIONS.map(
            (o) =>
              `<button type="button" class="chip ${isFollowingGender(o.id) ? 'is-on' : ''}" data-toggle-gender="${escapeHtml(o.id)}">${escapeHtml(o.label)}</button>`,
          ).join('')}
        </div>
      </div>
      <div class="follow-section">
        <p class="follow-section__title">Club / athlete</p>
        <div class="chip-row" style="margin-bottom:12px">
          <button type="button" class="chip ${state.followMode === 'club' ? 'is-on' : ''}" data-mode="club">Club / school</button>
          <button type="button" class="chip ${state.followMode === 'athlete' ? 'is-on' : ''}" data-mode="athlete">Athlete</button>
        </div>
        ${athleteNote}
        <input class="search" id="followSearch" type="search" placeholder="Search…" value="${escapeHtml(state.search)}" />
        ${pickAthlete ? renderCrewConfirm(pickAthlete) : ''}
        <div class="list">${list || '<p class="empty">No matches</p>'}</div>
      </div>
    </div>
    ${renderNotifySettings()}
  `;
}

function renderCountdownCard() {
  if (!hasAnyFollows()) return '';
  const next = nextFollowedRaceItem();
  if (!next) {
    return `
      <div class="panel panel--countdown panel--countdown-empty">
        <p class="countdown__eyebrow">My day</p>
        <p class="countdown__label">No upcoming followed races</p>
        <p class="panel__lead" style="margin:0">You’re all caught up for now.</p>
      </div>`;
  }
  const { race, matchLabel } = next;
  const cd = countdownCopy(race);
  return `
    <div class="panel panel--countdown ${cd.urgent ? 'is-urgent' : ''}">
      <p class="countdown__eyebrow">${escapeHtml(cd.label)}</p>
      <p class="countdown__clock" id="mydayCountdown" data-race-id="${escapeHtml(race.id)}">${escapeHtml(cd.detail)}</p>
      <p class="countdown__event">${escapeHtml(race.time)} · ${escapeHtml(race.eventType)}</p>
      <p class="countdown__who">${escapeHtml(matchLabel)} · ${escapeHtml(race.round)} ${escapeHtml(race.division)}</p>
    </div>`;
}

function renderMyDay() {
  if (state.selectedRaceId) {
    return renderRaceDetail(state.selectedRaceId);
  }
  if (!hasAnyFollows()) {
    return `
      <div class="panel">
        <h2>My day</h2>
        <p class="empty">Follow a club, athlete, or age group to see their heats here.</p>
        <button type="button" class="btn btn--primary" data-go="follow">Find someone to follow</button>
      </div>
      ${renderNotifySettings()}`;
  }
  const items = racesForFollows();
  const now = nowMs();
  return `
    ${renderCountdownCard()}
    <div class="panel">
      <h2>My day</h2>
      <p class="panel__lead">Heats that match your follows (club, confirmed crew, athlete, or age / gender).</p>
      ${
        items.length
          ? `<div class="race-list">
        ${items
          .map(({ race }) => {
            const phase = racePhase(now, race);
            return renderExpandableRace(race, phase, { showDay: true });
          })
          .join('')}
      </div>`
          : `<p class="empty">No matching heats in this daysheet.</p>`
      }
    </div>
    ${renderNotifySettings()}`;
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
  stopCountdownTimer();
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
    state.homeTimer = setInterval(() => {
      if (state.tab === 'home' || state.tab === 'schedule' || state.tab === 'myday') {
        render();
      }
    }, 30000);
  }

  if (state.tab === 'myday' && !state.selectedRaceId && hasAnyFollows()) {
    state.countdownTimer = setInterval(tickCountdown, 1000);
  }

  wireDom();
}

function tickCountdown() {
  const el = document.getElementById('mydayCountdown');
  if (!el || state.tab !== 'myday') return;
  const next = nextFollowedRaceItem();
  if (!next) {
    render();
    return;
  }
  const cd = countdownCopy(next.race);
  if (el.dataset.raceId !== next.race.id) {
    render();
    return;
  }
  el.textContent = cd.detail;
  const panel = el.closest('.panel--countdown');
  if (panel) panel.classList.toggle('is-urgent', cd.urgent);
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
      state.crewPick = null;
      render();
    });
  }
  for (const el of main.querySelectorAll('[data-toggle-club]')) {
    el.addEventListener('click', () => toggleClub(el.dataset.toggleClub));
  }
  for (const el of main.querySelectorAll('[data-pick-athlete]')) {
    el.addEventListener('click', () => openCrewPick(el.dataset.pickAthlete));
  }
  for (const el of main.querySelectorAll('[data-crew-toggle]')) {
    el.addEventListener('change', () => toggleCrewPickId(el.dataset.crewToggle));
  }
  main.querySelector('[data-crew-confirm]')?.addEventListener('click', () => confirmCrewPick());
  main.querySelector('[data-crew-cancel]')?.addEventListener('click', () => closeCrewPick());
  for (const el of main.querySelectorAll('[data-remove-crew]')) {
    el.addEventListener('click', () => removeCrewFollow(el.dataset.removeCrew));
  }
  main.querySelector('#crewConfirm')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  for (const el of main.querySelectorAll('[data-toggle-age]')) {
    el.addEventListener('click', () => toggleAgeGroup(el.dataset.toggleAge));
  }
  for (const el of main.querySelectorAll('[data-toggle-gender]')) {
    el.addEventListener('click', () => toggleGender(el.dataset.toggleGender));
  }
  main.querySelector('#notifyToggle')?.addEventListener('change', (e) => {
    setNotificationsEnabled(e.target.checked);
  });
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
    try {
      localStorage.removeItem('regattaNzDemoClock_v1');
    } catch {
      /* ignore */
    }
    render();
    queueNotifySync();
    if (state.notifySyncTimer) clearInterval(state.notifySyncTimer);
    state.notifySyncTimer = setInterval(syncNotifications, 5 * 60 * 1000);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="panel"><p class="empty">Could not load sample data.<br>${escapeHtml(err.message)}</p></div>`;
  }
}

boot();
