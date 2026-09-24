import {
  loadRegatta,
  REGATTA,
  racePhase,
  msOfDayFromDate,
  AGE_GROUP_OPTIONS,
  GENDER_OPTIONS,
  crewDisplayLabel,
  classifyRound,
  roundChipLabel,
  racesInRound,
  raceStageTitle,
  eventProgressionExplainer,
  progressionDestForPlace,
} from './data.js?v=35';
import { createLiveCourse, fetchRaceSnapshot, unofficialPlacings } from './live-course.js?v=35';
import { enhanceLogoImages } from './logo-cutout.js?v=35';
import {
  loadNotifyPrefs,
  saveNotifyPrefs,
  requestNotifyPermission,
  cancelScheduledNotifications,
  scheduleFollowedRaceNotifications,
  maybeWebNotifyRace,
  NOTIFY_BEFORE_MS,
} from './notify.js?v=35';
import { runIntro } from './intro.js?v=35';

runIntro();

const LS_FOLLOWS = 'regattaNzFollows_v1';
const LS_ACTIVE_DAY = 'regattaNzActiveDay_v1';

const state = {
  data: null,
  tab: 'home',
  followMode: 'club',
  search: '',
  /** @type {null | { athleteName: string, selected: Set<string> }} */
  crewPick: null,
  /** @type {null | { clubId: string, genders: string[], ageGroups: string[], classes: string[] }} */
  clubFunnel: null,
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
  /** Viewing day for Home / Schedule / My day (one day at a time). */
  scheduleDayIndex: 1,
  notifySyncTimer: null,
  /** Results tab */
  resultsFilter: 'all', // 'all' | 'followed'
  resultsEventNum: null,
  resultsRound: null,
  resultsExplainerOpen: false,
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

function scopeKey(clubId, genders, ageGroups, classes) {
  const g = (genders || []).slice().sort().join(',');
  const a = (ageGroups || []).slice().sort().join(',');
  const c = (classes || []).slice().sort().join(',');
  return `${clubId}|${g}|${a}|${c}`;
}

function normalizeClubScope(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clubId = String(raw.clubId || '').trim();
  if (!clubId) return null;
  const genders = Array.isArray(raw.genders) ? raw.genders.map(String).filter(Boolean) : [];
  const ageGroups = Array.isArray(raw.ageGroups) ? raw.ageGroups.map(String).filter(Boolean) : [];
  const classes = Array.isArray(raw.classes) ? raw.classes.map(String).filter(Boolean) : [];
  const id = String(raw.id || scopeKey(clubId, genders, ageGroups, classes));
  return {
    id,
    clubId,
    genders,
    ageGroups,
    classes,
    label: String(raw.label || id),
    crewCount: Number.isFinite(Number(raw.crewCount)) ? Number(raw.crewCount) : 0,
  };
}

function loadFollows() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_FOLLOWS) || '{}');
    const crews = Array.isArray(raw.crews)
      ? raw.crews.map(normalizeCrewFollow).filter(Boolean)
      : [];
    const clubScopes = Array.isArray(raw.clubScopes)
      ? raw.clubScopes.map(normalizeClubScope).filter(Boolean)
      : [];
    return {
      clubs: Array.isArray(raw.clubs) ? raw.clubs : [],
      clubScopes,
      athletes: Array.isArray(raw.athletes) ? raw.athletes : [],
      ageGroups: Array.isArray(raw.ageGroups) ? raw.ageGroups : [],
      genders: Array.isArray(raw.genders) ? raw.genders : [],
      crews,
    };
  } catch {
    return {
      clubs: [],
      clubScopes: [],
      athletes: [],
      ageGroups: [],
      genders: [],
      crews: [],
    };
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
    f.clubScopes.length +
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

/** Compact ⓘ control: title stays visible; tip expands on tap (collapsed by default). */
function infoTip(id, titleHtml, tipText, { html = false, label = 'More information' } = {}) {
  const tipId = `info-tip-${id}`;
  const body = html ? tipText : escapeHtml(tipText);
  return `<div class="info-tip">
    <div class="info-tip__head">
      ${titleHtml}
      <button type="button" class="info-tip__btn" data-info-tip="${escapeHtml(id)}" aria-expanded="false" aria-controls="${tipId}" aria-label="${escapeHtml(label)}">i</button>
    </div>
    <div class="info-tip__body" id="${tipId}" role="region" hidden>${body}</div>
  </div>`;
}

function nowMs() {
  return msOfDayFromDate();
}

function setTab(tab) {
  state.tab = tab;
  state.selectedRaceId = null;
  if (tab !== 'follow') {
    state.crewPick = null;
    state.clubFunnel = null;
  }
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
  // Legacy global age/gender follows (still matched if present in storage).
  if (ages.length && genders.length) return ageOk && genderOk;
  if (ages.length) return ageOk;
  return genderOk;
}

function laneMatchesClubScope(lane, race, scope) {
  if (!scope || lane.clubId !== scope.clubId) return false;
  if (scope.genders?.length && (!race.gender || !scope.genders.includes(race.gender))) {
    return false;
  }
  if (scope.ageGroups?.length && (!race.ageGroup || !scope.ageGroups.includes(race.ageGroup))) {
    return false;
  }
  if (scope.classes?.length && (!race.boatClass || !scope.classes.includes(race.boatClass))) {
    return false;
  }
  return true;
}

function raceMatchesAnyClubScope(race) {
  const scopes = state.follows.clubScopes || [];
  if (!scopes.length) return [];
  return race.lanes.filter((l) => scopes.some((s) => laneMatchesClubScope(l, race, s)));
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
    for (const lane of raceMatchesAnyClubScope(race)) {
      if (!matchedLanes.some((l) => l.lane === lane.lane)) matchedLanes.push(lane);
    }
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

/** Parse daysheet labels like "Friday 27th March 2026". */
function parseDayLabelDate(label) {
  const m = String(label || '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})/i);
  if (!m) return null;
  const months = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };
  const month = months[m[2].toLowerCase()];
  if (month == null) return null;
  return new Date(Number(m[3]), month, Number(m[1]));
}

/**
 * Prefer today's calendar day when the daysheet includes it;
 * otherwise the final day (e.g. Maadi Cup finals).
 */
function pickDefaultDayIndex(days) {
  if (!days?.length) return 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const d of days) {
    const dt = parseDayLabelDate(d.label);
    if (!dt) continue;
    dt.setHours(0, 0, 0, 0);
    if (dt.getTime() === today.getTime()) return d.index;
  }
  return days[days.length - 1].index;
}

function loadSavedDayIndex(regattaCode, days) {
  if (!days?.length) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_ACTIVE_DAY) || 'null');
    if (!raw || String(raw.code || '').toLowerCase() !== String(regattaCode || '').toLowerCase()) {
      return null;
    }
    const idx = Number(raw.dayIndex);
    if (days.some((d) => d.index === idx)) return idx;
  } catch {
    /* ignore */
  }
  return null;
}

function saveActiveDayIndex(regattaCode, dayIndex) {
  try {
    localStorage.setItem(
      LS_ACTIVE_DAY,
      JSON.stringify({ code: String(regattaCode || ''), dayIndex: Number(dayIndex) }),
    );
  } catch {
    /* ignore */
  }
}

function ensureActiveDay() {
  const days = state.data?.days || [];
  if (!days.length) return null;
  if (!days.some((d) => d.index === state.scheduleDayIndex)) {
    state.scheduleDayIndex = pickDefaultDayIndex(days);
  }
  return days.find((d) => d.index === state.scheduleDayIndex) || days[days.length - 1];
}

function setActiveDay(dayIndex) {
  state.scheduleDayIndex = Number(dayIndex);
  const code = state.data?.meta?.code || state.data?.paths?.code || '';
  saveActiveDayIndex(code, state.scheduleDayIndex);
}

function racesOnActiveDay() {
  const day = ensureActiveDay();
  return day ? day.races : state.data?.races || [];
}

function followedItemsOnActiveDay() {
  const day = ensureActiveDay();
  if (!day) return racesForFollows();
  return racesForFollows().filter((item) => item.race.dayIndex === day.index);
}

/** Soonest followed race on the active day that has not finished yet. */
function nextFollowedRaceItem() {
  const now = nowMs();
  let best = null;
  for (const item of followedItemsOnActiveDay()) {
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

function genderLabel(id) {
  return GENDER_OPTIONS.find((o) => o.id === id)?.label || id;
}

function ageGroupLabel(id) {
  return AGE_GROUP_OPTIONS.find((o) => o.id === id)?.label || id;
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

function clubCrewEntries(clubId) {
  if (!state.data || !clubId) return [];
  const out = [];
  for (const race of state.data.races) {
    for (const lane of race.lanes) {
      if (lane.clubId !== clubId) continue;
      out.push({
        id: `${race.id}|${lane.lane}`,
        race,
        lane,
        gender: race.gender || null,
        ageGroup: race.ageGroup || null,
        boatClass: race.boatClass || null,
        label: crewDisplayLabel(lane.clubCode || lane.clubName, race.eventType),
        time: race.time,
        eventType: race.eventType,
      });
    }
  }
  return out;
}

function filterClubCrews(entries, { genders = [], ageGroups = [], classes = [] } = {}) {
  return entries.filter((e) => {
    if (genders.length && (!e.gender || !genders.includes(e.gender))) return false;
    if (ageGroups.length && (!e.ageGroup || !ageGroups.includes(e.ageGroup))) return false;
    if (classes.length && (!e.boatClass || !classes.includes(e.boatClass))) return false;
    return true;
  });
}

function uniqueSorted(values, orderHints = []) {
  const set = new Set(values.filter(Boolean));
  const hintIndex = new Map(orderHints.map((id, i) => [id, i]));
  return [...set].sort((a, b) => {
    const ia = hintIndex.has(a) ? hintIndex.get(a) : 999;
    const ib = hintIndex.has(b) ? hintIndex.get(b) : 999;
    if (ia !== ib) return ia - ib;
    return String(a).localeCompare(String(b));
  });
}

function openClubFunnel(clubId) {
  state.clubFunnel = { clubId, genders: [], ageGroups: [], classes: [] };
  state.crewPick = null;
  render();
}

function closeClubFunnel() {
  state.clubFunnel = null;
  render();
}

function toggleFunnelValue(field, value) {
  if (!state.clubFunnel) return;
  const list = state.clubFunnel[field];
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
  else list.push(value);
  // Clear dependent filters when parent changes
  if (field === 'genders') {
    state.clubFunnel.ageGroups = [];
    state.clubFunnel.classes = [];
  } else if (field === 'ageGroups') {
    state.clubFunnel.classes = [];
  }
  render();
}

function scopeLabelFor(club, genders, ageGroups, classes) {
  const bits = [club?.name || club?.code || 'Club'];
  if (genders.length) bits.push(genders.map(genderLabel).join('/'));
  if (ageGroups.length) bits.push(ageGroups.map(ageGroupLabel).join('/'));
  if (classes.length) bits.push(classes.join('/'));
  return bits.join(' · ');
}

function followWholeClub(clubId) {
  if (!isFollowingClub(clubId)) {
    state.follows.clubs = [...state.follows.clubs, clubId];
  }
  // Drop redundant scopes for this club (whole club covers them)
  state.follows.clubScopes = state.follows.clubScopes.filter((s) => s.clubId !== clubId);
  state.clubFunnel = null;
  saveFollows();
  render();
}

function unfollowClub(clubId) {
  state.follows.clubs = state.follows.clubs.filter((c) => c !== clubId);
  saveFollows();
  render();
}

function addClubScopeFromFunnel() {
  const funnel = state.clubFunnel;
  if (!funnel) return;
  const club = state.data.clubById.get(funnel.clubId);
  if (!club) return;
  const { genders, ageGroups, classes } = funnel;
  // No filters → whole club
  if (!genders.length && !ageGroups.length && !classes.length) {
    followWholeClub(funnel.clubId);
    return;
  }
  const entries = filterClubCrews(clubCrewEntries(funnel.clubId), funnel);
  const id = scopeKey(funnel.clubId, genders, ageGroups, classes);
  const scope = {
    id,
    clubId: funnel.clubId,
    genders: [...genders],
    ageGroups: [...ageGroups],
    classes: [...classes],
    label: scopeLabelFor(club, genders, ageGroups, classes),
    crewCount: entries.length,
  };
  state.follows.clubScopes = state.follows.clubScopes.filter((s) => s.id !== id);
  state.follows.clubScopes.push(scope);
  // If whole-club was followed, keep it (OR matching); user can remove either
  state.clubFunnel = null;
  saveFollows();
  render();
}

function removeClubScope(id) {
  state.follows.clubScopes = state.follows.clubScopes.filter((s) => s.id !== id);
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
  state.clubFunnel = null;
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
  const scoped = raceMatchesAnyClubScope(race);
  if (scoped[0]) return scoped[0].lane;
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
  if ((state.follows.clubScopes || []).some((s) => laneMatchesClubScope(lane, race, s))) {
    return true;
  }
  if (matchesAgeGender(race)) return true;
  return false;
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
    ${infoTip(
      'livestream',
      '<h2>Livestream</h2>',
      stream.note || 'Livestream not on air for this regatta yet.',
      { label: 'About livestream' },
    )}
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
  for (const race of racesOnActiveDay()) {
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

function renderActiveDayHint() {
  const day = ensureActiveDay();
  if (!day) return '';
  const days = state.data?.days || [];
  if (days.length <= 1) {
    return `<p class="muted" style="margin:0 0 12px">${escapeHtml(day.label)}</p>`;
  }
  return `<p class="muted" style="margin:0 0 12px">Day ${day.index} · ${escapeHtml(day.label)} · change day on Schedule</p>`;
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
      ${renderActiveDayHint()}
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
  const day = ensureActiveDay() || days[days.length - 1];
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

function eventsForResultsFilter() {
  const all = state.data.events || [];
  if (state.resultsFilter !== 'followed') return all;
  const followedIds = new Set(racesForFollows().map((x) => x.race.id));
  return all.filter((ev) => ev.races.some((r) => followedIds.has(r.id)));
}

function ensureResultsSelection() {
  const events = eventsForResultsFilter();
  if (!events.length) {
    state.resultsEventNum = null;
    state.resultsRound = null;
    return null;
  }
  let ev = events.find((e) => e.eventNum === state.resultsEventNum) || null;
  if (!ev) {
    ev = events[0];
    state.resultsEventNum = ev.eventNum;
    state.resultsRound = null;
  }
  const rounds = ev.rounds?.length ? ev.rounds : [];
  if (!rounds.length) {
    state.resultsRound = null;
    return ev;
  }
  if (!rounds.includes(state.resultsRound)) {
    // Prefer first round that still has races without results; else last round.
    const unfinished = rounds.find((k) =>
      racesInRound(ev.races, k).some((r) => !r.hasResult),
    );
    state.resultsRound = unfinished || rounds[rounds.length - 1];
  }
  return ev;
}

function renderResultsPlacings(race) {
  const format = race.progressionFormat || race.progression || race.resultFormat || '';
  const showProg = Boolean(format);
  if (!race.result?.placings?.length) {
    return `<div class="lanes">${race.lanes
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
      .join('')}</div>
      <p class="muted empty--sm">Awaiting official results</p>`;
  }
  return `<div class="lanes lanes--results">
    ${race.result.placings
      .map((p) => {
        const place = p.place >= 90 ? '—' : p.place;
        const dest =
          showProg && Number.isFinite(p.place) && p.place < 90
            ? progressionDestForPlace(p.place, format)
            : '';
        const followed =
          (state.follows.clubs || []).includes(p.clubId) ||
          (state.follows.clubScopes || []).some((s) => s.clubId === p.clubId);
        return `<div class="lane ${followed ? 'is-followed' : ''}">
          <span class="lane__n">${place}</span>
          ${logoHtml(p.logoUrl, p.clubCode)}
          <div class="lane__crew">${escapeHtml(p.competitor)}
            <small>${escapeHtml(p.time || '')}</small>
          </div>
          ${
            dest
              ? `<span class="prog-pill prog-pill--${dest === '—' ? 'out' : 'go'}">${escapeHtml(dest)}</span>`
              : ''
          }
        </div>`;
      })
      .join('')}
  </div>`;
}

function renderResultsRaceCard(race) {
  const open = state.expanded.has(race.id);
  const phase = racePhase(nowMs(), race);
  const title = raceStageTitle(race);
  const nextRounds = (ensureResultsSelection()?.rounds || []);
  const curIdx = nextRounds.indexOf(state.resultsRound);
  const nextChip = curIdx >= 0 ? nextRounds[curIdx + 1] : null;
  return `<article class="race-card race-card--${phase.status}">
    <button type="button" class="race-card__head" data-expand="${escapeHtml(race.id)}" aria-expanded="${open}">
      <div class="race-card__top">
        <span class="heat__time">${escapeHtml(title)}</span>
        ${badgeForStatus(phase.status)}
      </div>
      <p class="heat__event">Race ${escapeHtml(String(race.raceNum || race.key))} · ${escapeHtml(race.time || '—')}</p>
      <p class="heat__who">tap to ${open ? 'hide' : 'show'} results</p>
    </button>
    ${
      open
        ? `<div class="race-card__body">
      ${renderResultsPlacings(race)}
      ${
        nextChip
          ? `<button type="button" class="btn btn--ghost" style="margin-top:10px" data-results-round="${nextChip}">Go to ${escapeHtml(roundChipLabel(nextChip))}</button>`
          : ''
      }
    </div>`
        : ''
    }
  </article>`;
}

function renderResults() {
  const events = eventsForResultsFilter();
  const followedEmpty = state.resultsFilter === 'followed' && !events.length && !hasAnyFollows();
  const followedNoEvents = state.resultsFilter === 'followed' && !events.length && hasAnyFollows();

  if (!state.data.events?.length) {
    return `<div class="panel"><p class="empty">No events on the daysheet</p></div>`;
  }

  const ev = ensureResultsSelection();
  const rounds = ev?.rounds || [];
  const roundRaces = ev && state.resultsRound ? racesInRound(ev.races, state.resultsRound) : [];
  const explainer = ev ? eventProgressionExplainer(ev) : '';

  return `
    <div class="panel panel--tight results-head">
      <h2>Results</h2>
      <p class="panel__lead">Heats through finals for one event</p>
      <div class="chip-row" style="margin-bottom:12px" role="group" aria-label="Event filter">
        <button type="button" class="chip ${state.resultsFilter === 'all' ? 'is-on' : ''}" data-results-filter="all">All events</button>
        <button type="button" class="chip ${state.resultsFilter === 'followed' ? 'is-on' : ''}" data-results-filter="followed">Followed</button>
      </div>
      ${
        followedEmpty
          ? `<p class="empty empty--sm">Follow a club or athlete first, then filter here.</p>
             <button type="button" class="btn btn--primary" data-go="follow">Follow</button>`
          : ''
      }
      ${
        followedNoEvents
          ? `<p class="empty empty--sm">None of your follows appear in this regatta’s events yet.</p>`
          : ''
      }
      ${
        events.length
          ? `<label class="results-select-label">
              <span class="muted">Event</span>
              <select class="results-select" id="resultsEventSelect" aria-label="Select event">
                ${events
                  .map(
                    (e) =>
                      `<option value="${escapeHtml(e.eventNum)}" ${e.eventNum === state.resultsEventNum ? 'selected' : ''}>${escapeHtml(e.displayTitle)}</option>`,
                  )
                  .join('')}
              </select>
            </label>`
          : ''
      }
      ${
        ev && explainer
          ? `<button type="button" class="results-explainer-toggle" data-results-explainer aria-expanded="${state.resultsExplainerOpen}">
              How this event progresses ${state.resultsExplainerOpen ? '▴' : '▾'}
            </button>
            <div class="results-explainer" ${state.resultsExplainerOpen ? '' : 'hidden'}>
              <p>${escapeHtml(explainer).replace(/\n/g, '<br>')}</p>
            </div>`
          : ''
      }
    </div>
    ${
      ev && rounds.length
        ? `<div class="chip-row chip-row--scroll results-rounds" role="tablist" aria-label="Round">
        ${rounds
          .map(
            (k) =>
              `<button type="button" class="chip ${k === state.resultsRound ? 'is-on' : ''}" data-results-round="${k}" role="tab" aria-selected="${k === state.resultsRound}">${escapeHtml(roundChipLabel(k))}</button>`,
          )
          .join('')}
      </div>
      <div class="panel panel--tight">
        <h2>${escapeHtml(roundChipLabel(state.resultsRound))} <span class="count">${roundRaces.length}</span></h2>
        <div class="race-list">
          ${
            roundRaces.length
              ? roundRaces.map((r) => renderResultsRaceCard(r)).join('')
              : '<p class="empty empty--sm">No races in this round</p>'
          }
        </div>
      </div>`
        : ev
          ? `<div class="panel"><p class="empty">No round structure for this event</p></div>`
          : ''
    }
  `;
}

function renderNotifySettings() {
  const on = state.notify.enabled;
  const mins = Math.round(NOTIFY_BEFORE_MS / 60000);
  return `
    <div class="panel panel--settings">
      ${infoTip(
        'notifications',
        '<h2>Notifications</h2>',
        `Alert ~${mins} min before a followed crew races. Scheduled on this device from the daysheet (works offline once loaded). Native APK preferred.`,
        { label: 'About notifications' },
      )}
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
        <div class="crew-confirm__head">
          <p class="crew-confirm__title">Confirm crews for ${escapeHtml(athlete.name)}</p>
          <div class="crew-confirm__actions">
            <button type="button" class="btn btn--ghost" data-crew-cancel>Close</button>
          </div>
        </div>
        <p class="empty empty--sm">No crew entries found for this athlete in the current draw.</p>
      </div>`;
  }
  return `
    <div class="crew-confirm" id="crewConfirm">
      <div class="crew-confirm__head">
        ${infoTip(
          'crew-confirm',
          `<p class="crew-confirm__title">Confirm crews for ${escapeHtml(athlete.name)}</p>`,
          'Tick the boat(s) to follow, then add. Allocation may change if entries change.',
          { label: 'About crew confirmation' },
        )}
        <div class="crew-confirm__actions">
          <button type="button" class="btn btn--ghost" data-crew-cancel>Cancel</button>
          <button type="button" class="btn btn--primary" data-crew-confirm>
            ${pick.selected.size ? `Add ${pick.selected.size} crew${pick.selected.size === 1 ? '' : 's'}` : 'Clear crews'}
          </button>
        </div>
      </div>
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
    </div>`;
}

function renderFollowingSummary() {
  const chips = [];
  for (const id of state.follows.clubs) {
    const club = state.data.clubById.get(id);
    const n = club?.crewCount || clubCrewEntries(id).length;
    const name = club?.name || id;
    chips.push(
      `<button type="button" class="chip is-on" data-unfollow-club="${escapeHtml(id)}" title="Unfollow">${escapeHtml(name)} · ${n} crews ×</button>`,
    );
  }
  for (const s of state.follows.clubScopes || []) {
    chips.push(
      `<button type="button" class="chip is-on" data-remove-scope="${escapeHtml(s.id)}" title="Unfollow">${escapeHtml(s.label)}${s.crewCount ? ` · ${s.crewCount}` : ''} ×</button>`,
    );
  }
  for (const c of state.follows.crews) {
    chips.push(
      `<button type="button" class="chip is-on" data-remove-crew="${escapeHtml(c.id)}" title="Unfollow">${escapeHtml(c.label)} ×</button>`,
    );
  }
  // Legacy global age/gender (if still in storage)
  for (const id of state.follows.ageGroups) {
    chips.push(
      `<button type="button" class="chip is-on" data-remove-legacy-age="${escapeHtml(id)}">${escapeHtml(ageGroupLabel(id))} ×</button>`,
    );
  }
  for (const id of state.follows.genders) {
    chips.push(
      `<button type="button" class="chip is-on" data-remove-legacy-gender="${escapeHtml(id)}">${escapeHtml(genderLabel(id))} ×</button>`,
    );
  }
  if (!chips.length) return '';
  return `<div class="follow-section">
    <p class="follow-section__title">Following</p>
    <div class="chip-row">${chips.join('')}</div>
  </div>`;
}

function renderClubFunnel() {
  const funnel = state.clubFunnel;
  if (!funnel) return '';
  const club = state.data.clubById.get(funnel.clubId);
  if (!club) return '';
  const all = clubCrewEntries(funnel.clubId);
  const afterGender = filterClubCrews(all, { genders: funnel.genders });
  const afterAge = filterClubCrews(all, {
    genders: funnel.genders,
    ageGroups: funnel.ageGroups,
  });
  const matched = filterClubCrews(all, funnel);

  const genderOpts = uniqueSorted(
    all.map((e) => e.gender),
    GENDER_OPTIONS.map((o) => o.id),
  );
  const ageOpts = uniqueSorted(
    afterGender.map((e) => e.ageGroup),
    AGE_GROUP_OPTIONS.map((o) => o.id),
  );
  const classOpts = uniqueSorted(afterAge.map((e) => e.boatClass));

  const hasGender = funnel.genders.length > 0;
  const hasAge = funnel.ageGroups.length > 0;
  const hasClass = funnel.classes.length > 0;
  const stepClub = 'is-done is-active';
  const stepGender = hasGender ? 'is-done is-active' : genderOpts.length ? 'is-active' : '';
  const stepAge = hasAge ? 'is-done is-active' : hasGender || !genderOpts.length ? 'is-active' : '';
  const stepClass =
    hasClass ? 'is-done is-active' : hasAge || (!ageOpts.length && (hasGender || !genderOpts.length))
      ? 'is-active'
      : '';

  const previewLimit = 4;
  const preview = matched.slice(0, previewLimit);
  const more = matched.length - preview.length;
  const scoped = hasGender || hasAge || hasClass;
  const followLabel = scoped
    ? `Follow these ${matched.length} crew${matched.length === 1 ? '' : 's'}`
    : `Follow all ${all.length} crews`;

  const filterSections = [
    genderOpts.length
      ? `<div class="follow-section follow-section--tight">
        <p class="follow-section__title">Gender</p>
        <div class="chip-row chip-row--tight">
          ${genderOpts
            .map(
              (id) =>
                `<button type="button" class="chip chip--sm ${funnel.genders.includes(id) ? 'is-on' : ''}" data-funnel-gender="${escapeHtml(id)}">${escapeHtml(genderLabel(id))}</button>`,
            )
            .join('')}
        </div>
      </div>`
      : '',
    ageOpts.length
      ? `<div class="follow-section follow-section--tight">
        <p class="follow-section__title">Age / level</p>
        <div class="chip-row chip-row--tight">
          ${ageOpts
            .map(
              (id) =>
                `<button type="button" class="chip chip--sm ${funnel.ageGroups.includes(id) ? 'is-on' : ''}" data-funnel-age="${escapeHtml(id)}">${escapeHtml(ageGroupLabel(id))}</button>`,
            )
            .join('')}
        </div>
      </div>`
      : '',
    classOpts.length
      ? `<div class="follow-section follow-section--tight">
        <p class="follow-section__title">Class</p>
        <div class="chip-row chip-row--tight">
          ${classOpts
            .map(
              (id) =>
                `<button type="button" class="chip chip--sm ${funnel.classes.includes(id) ? 'is-on' : ''}" data-funnel-class="${escapeHtml(id)}">${escapeHtml(id)}</button>`,
            )
            .join('')}
        </div>
      </div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return `
    <div class="club-funnel">
      <div class="funnel-top">
        <button type="button" class="btn btn--ghost funnel-back" data-funnel-back>← All clubs</button>
        <div class="funnel-club">
          ${logoHtml(club.logo, club.code)}
          <div class="funnel-club__meta">
            <strong>${escapeHtml(club.name)}</strong>
            <span>${all.length} crew${all.length === 1 ? '' : 's'} in this regatta</span>
          </div>
          ${
            isFollowingClub(club.id)
              ? `<button type="button" class="chip chip--sm is-on" data-unfollow-club="${escapeHtml(club.id)}">Following ×</button>`
              : ''
          }
        </div>
        <ol class="funnel-steps" aria-label="Narrow by">
          <li class="${stepClub}">Club</li>
          <li class="${stepGender}">Gender</li>
          <li class="${stepAge}">Age / level</li>
          <li class="${stepClass}">Class</li>
        </ol>
        <button type="button" class="btn btn--primary funnel-cta" data-funnel-confirm ${matched.length ? '' : 'disabled'}>
          ${escapeHtml(followLabel)}
        </button>
      </div>
      ${
        filterSections
          ? `<div class="funnel-filters">${filterSections}</div>`
          : ''
      }
      <div class="crew-preview">
        <p class="follow-section__title">Crews you’ll follow · ${matched.length}</p>
        ${
          matched.length
            ? `<ul class="crew-preview__list">
            ${preview
              .map(
                (e) =>
                  `<li><strong>${escapeHtml(e.label)}</strong><span>${escapeHtml([e.time, e.eventType].filter(Boolean).join(' · '))}</span></li>`,
              )
              .join('')}
            ${more > 0 ? `<li class="crew-preview__more">+${more} more</li>` : ''}
          </ul>`
            : `<p class="empty empty--sm">No crews match these filters.</p>`
        }
      </div>
    </div>`;
}

function renderClubList() {
  const q = state.search.trim().toLowerCase();
  const clubs = state.data.clubs.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
  );
  if (!clubs.length) return '<p class="empty">No clubs match</p>';
  return clubs
    .slice(0, 100)
    .map((c) => {
      const n = c.crewCount || clubCrewEntries(c.id).length;
      const following = isFollowingClub(c.id);
      const scoped = (state.follows.clubScopes || []).some((s) => s.clubId === c.id);
      return `<button type="button" class="list-item" data-open-club="${escapeHtml(c.id)}">
        ${logoHtml(c.logo, c.code)}
        <span class="list-item__meta">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${n} crew${n === 1 ? '' : 's'}${following ? ' · following all' : scoped ? ' · scoped follow' : ''}</span>
        </span>
        <span class="list-item__action">${following || scoped ? 'Edit' : 'Choose'}</span>
      </button>`;
    })
    .join('');
}

function renderAthleteList() {
  const q = state.search.trim().toLowerCase();
  const athletes = state.data.athletes.filter((a) => !q || a.name.toLowerCase().includes(q));
  if (!athletes.length) return '<p class="empty">No athletes match</p>';
  return athletes
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
}

function renderFollow() {
  const pickAthlete =
    state.crewPick &&
    state.data.athletes.find(
      (a) => a.name.toLowerCase() === state.crewPick.athleteName.toLowerCase(),
    );

  const modeToggle = `
    <div class="mode-toggle" role="tablist" aria-label="Follow mode">
      <button type="button" class="mode-toggle__btn ${state.followMode === 'athlete' ? 'is-on' : ''}" data-mode="athlete" role="tab" aria-selected="${state.followMode === 'athlete'}">Athlete</button>
      <button type="button" class="mode-toggle__btn ${state.followMode === 'club' ? 'is-on' : ''}" data-mode="club" role="tab" aria-selected="${state.followMode === 'club'}">Club</button>
    </div>`;

  let body = '';
  if (state.followMode === 'club') {
    if (state.clubFunnel) {
      body = renderClubFunnel();
    } else {
      body = `
        ${infoTip(
          'club-funnel',
          '<p class="follow-section__title">Clubs</p>',
          'Pick a club or school, then follow everyone — or narrow by gender, age/level, and class.',
          { label: 'How club follow works' },
        )}
        <input class="search" id="followSearch" type="search" placeholder="Search clubs…" value="${escapeHtml(state.search)}" />
        <div class="list">${renderClubList()}</div>`;
    }
  } else {
    body = `
      ${infoTip(
        'athlete-alloc',
        '<p class="follow-section__title">Athletes</p>',
        'Crew allocation is estimated from the published draw and <strong>may be wrong if entries change</strong>. Confirm which boat(s) to follow.',
        { html: true, label: 'About athlete crew allocation' },
      )}
      <input class="search" id="followSearch" type="search" placeholder="Search athletes…" value="${escapeHtml(state.search)}" />
      ${pickAthlete ? renderCrewConfirm(pickAthlete) : ''}
      <div class="list">${renderAthleteList()}</div>`;
  }

  return `
    <div class="panel">
      ${infoTip(
        'follow',
        '<h2>Follow</h2>',
        'Saved on this phone for My day, alerts, and lane highlights.',
        { label: 'About Follow' },
      )}
      ${renderFollowingSummary()}
      ${modeToggle}
      ${body}
    </div>
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
        <p class="empty">Follow a club, athlete, or scoped crews to see their heats here.</p>
        <button type="button" class="btn btn--primary" data-go="follow">Find someone to follow</button>
      </div>
      ${renderNotifySettings()}`;
  }
  const items = followedItemsOnActiveDay();
  const now = nowMs();
  return `
    ${renderCountdownCard()}
    <div class="panel">
      ${infoTip(
        'myday',
        '<h2>My day</h2>',
        'Heats that match your follows on the selected day (change day on Schedule).',
        { label: 'About My day' },
      )}
      ${renderActiveDayHint()}
      ${
        items.length
          ? `<div class="race-list">
        ${items
          .map(({ race }) => {
            const phase = racePhase(now, race);
            return renderExpandableRace(race, phase);
          })
          .join('')}
      </div>`
          : `<p class="empty">No matching heats on this day. Try another day on Schedule, or follow more crews.</p>`
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
        ${infoTip(
          'unofficial',
          '<h2>Unofficial results</h2>',
          'Based on CV tracking — not official RowIT results.',
          { label: 'About unofficial results' },
        )}
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
  else if (state.tab === 'results') main.innerHTML = renderResults();
  else if (state.tab === 'follow') main.innerHTML = renderFollow();
  else if (state.tab === 'myday') main.innerHTML = renderMyDay();
  else if (state.tab === 'live') {
    main.innerHTML = renderLive();
    startLive();
  }

  if (state.tab === 'home' || state.tab === 'schedule' || state.tab === 'myday' || state.tab === 'results') {
    state.homeTimer = setInterval(() => {
        if (state.tab === 'home' || state.tab === 'schedule' || state.tab === 'myday' || state.tab === 'results') {
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
  main.querySelector('[data-go="results"]')?.addEventListener('click', () => setTab('results'));

  for (const btn of main.querySelectorAll('[data-results-filter]')) {
    btn.addEventListener('click', () => {
      state.resultsFilter = btn.dataset.resultsFilter === 'followed' ? 'followed' : 'all';
      state.resultsEventNum = null;
      state.resultsRound = null;
      render();
    });
  }
  main.querySelector('#resultsEventSelect')?.addEventListener('change', (e) => {
    state.resultsEventNum = String(e.target.value || '').trim() || null;
    state.resultsRound = null;
    state.expanded.clear();
    render();
  });
  for (const btn of main.querySelectorAll('[data-results-round]')) {
    btn.addEventListener('click', () => {
      state.resultsRound = btn.dataset.resultsRound || null;
      state.expanded.clear();
      render();
    });
  }
  main.querySelector('[data-results-explainer]')?.addEventListener('click', () => {
    state.resultsExplainerOpen = !state.resultsExplainerOpen;
    render();
  });

  for (const btn of main.querySelectorAll('[data-info-tip]')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.infoTip;
      const body = document.getElementById(`info-tip-${id}`);
      if (!body) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      for (const other of main.querySelectorAll('[data-info-tip]')) {
        if (other === btn) continue;
        other.setAttribute('aria-expanded', 'false');
        const otherBody = document.getElementById(`info-tip-${other.dataset.infoTip}`);
        if (otherBody) otherBody.hidden = true;
      }
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      body.hidden = open;
    });
  }

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
      setActiveDay(el.dataset.day);
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
      state.clubFunnel = null;
      state.search = '';
      render();
    });
  }
  for (const el of main.querySelectorAll('[data-open-club]')) {
    el.addEventListener('click', () => openClubFunnel(el.dataset.openClub));
  }
  main.querySelector('[data-funnel-back]')?.addEventListener('click', () => closeClubFunnel());
  main.querySelector('[data-funnel-confirm]')?.addEventListener('click', () => addClubScopeFromFunnel());
  for (const el of main.querySelectorAll('[data-funnel-gender]')) {
    el.addEventListener('click', () => toggleFunnelValue('genders', el.dataset.funnelGender));
  }
  for (const el of main.querySelectorAll('[data-funnel-age]')) {
    el.addEventListener('click', () => toggleFunnelValue('ageGroups', el.dataset.funnelAge));
  }
  for (const el of main.querySelectorAll('[data-funnel-class]')) {
    el.addEventListener('click', () => toggleFunnelValue('classes', el.dataset.funnelClass));
  }
  for (const el of main.querySelectorAll('[data-unfollow-club]')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      unfollowClub(el.dataset.unfollowClub);
    });
  }
  for (const el of main.querySelectorAll('[data-remove-scope]')) {
    el.addEventListener('click', () => removeClubScope(el.dataset.removeScope));
  }
  for (const el of main.querySelectorAll('[data-remove-legacy-age]')) {
    el.addEventListener('click', () => {
      state.follows.ageGroups = state.follows.ageGroups.filter((a) => a !== el.dataset.removeLegacyAge);
      saveFollows();
      render();
    });
  }
  for (const el of main.querySelectorAll('[data-remove-legacy-gender]')) {
    el.addEventListener('click', () => {
      state.follows.genders = state.follows.genders.filter((g) => g !== el.dataset.removeLegacyGender);
      saveFollows();
      render();
    });
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
    if (state.data.days.length) {
      const code = state.data.meta?.code || state.data.paths?.code || '';
      const saved = loadSavedDayIndex(code, state.data.days);
      state.scheduleDayIndex = saved ?? pickDefaultDayIndex(state.data.days);
      saveActiveDayIndex(code, state.scheduleDayIndex);
    }
    try {
      localStorage.removeItem('regattaNzDemoClock_v1');
    } catch {
      /* ignore */
    }
    try {
      const q = new URLSearchParams(location.search);
      const ev = String(q.get('event') || '').trim();
      const raceQ = String(q.get('race') || '').trim();
      if (raceQ) {
        const num = Number(raceQ);
        const found =
          state.data.races.find((r) => r.raceNum === num) ||
          state.data.races.find((r) => String(r.key).startsWith(raceQ));
        if (found) {
          state.tab = 'results';
          state.resultsEventNum = found.eventNum;
          state.resultsRound = classifyRound(found.round);
          state.expanded.add(found.id);
          for (const btn of tabbar.querySelectorAll('.tab')) {
            btn.classList.toggle('is-active', btn.dataset.tab === 'results');
          }
        }
      } else if (ev) {
        state.tab = 'results';
        state.resultsEventNum = ev;
        for (const btn of tabbar.querySelectorAll('.tab')) {
          btn.classList.toggle('is-active', btn.dataset.tab === 'results');
        }
      }
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
