/**
 * Local race alerts — Capacitor Local Notifications on APK,
 * optional Web Notifications API mirror in browser.
 *
 * Schedules from the daysheet once loaded (works offline-ish after that).
 * No FCM / push server required for v1.
 */

/** Minutes before scheduled start — matches start-blocks window. */
export const NOTIFY_BEFORE_MS = 10 * 60 * 1000;

const LS_NOTIFY = 'regattaNzNotify_v1';
const CHANNEL_ID = 'race-alerts';
const ID_BASE = 710_000;

/**
 * @returns {{ enabled: boolean }}
 */
export function loadNotifyPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_NOTIFY) || '{}');
    return { enabled: Boolean(raw.enabled) };
  } catch {
    return { enabled: false };
  }
}

export function saveNotifyPrefs(prefs) {
  localStorage.setItem(LS_NOTIFY, JSON.stringify({ enabled: Boolean(prefs.enabled) }));
}

function capacitorNotifications() {
  try {
    const Cap = typeof window !== 'undefined' ? window.Capacitor : null;
    if (!Cap?.isNativePlatform?.()) return null;
    return Cap.Plugins?.LocalNotifications || null;
  } catch {
    return null;
  }
}

function notificationIdForRace(raceId) {
  let h = 0;
  const s = String(raceId || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ID_BASE + (h % 200_000);
}

function fireAtForRace(race, dayDate) {
  const startMs = race.startMsOfDay;
  if (!Number.isFinite(startMs)) return null;
  const base = dayDate instanceof Date ? new Date(dayDate) : new Date();
  const at = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    0,
    0,
    0,
    0,
  );
  at.setTime(at.getTime() + startMs - NOTIFY_BEFORE_MS);
  return at;
}

/**
 * Resolve calendar date for a race day label if possible; else today.
 * Day labels look like "Friday 6th March 2026".
 */
function guessRaceCalendarDate(race) {
  const label = String(race.dayLabel || '');
  const m = label.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})/i);
  if (m) {
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
    if (month != null) {
      return new Date(Number(m[3]), month, Number(m[1]));
    }
  }
  return new Date();
}

export async function requestNotifyPermission() {
  const native = capacitorNotifications();
  if (native?.requestPermissions) {
    const res = await native.requestPermissions();
    if (native.createChannel) {
      try {
        await native.createChannel({
          id: CHANNEL_ID,
          name: 'Race alerts',
          description: 'Followed crews about to race',
          importance: 5,
          visibility: 1,
          sound: 'default',
        });
      } catch {
        /* channel may already exist */
      }
    }
    return String(res?.display || '').toLowerCase() === 'granted';
  }
  if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const p = await Notification.requestPermission();
    return p === 'granted';
  }
  return false;
}

export async function cancelScheduledNotifications() {
  const native = capacitorNotifications();
  if (native?.getPending && native?.cancel) {
    try {
      const pending = await native.getPending();
      const ids = (pending?.notifications || [])
        .map((n) => n.id)
        .filter((id) => id >= ID_BASE && id < ID_BASE + 200_000);
      if (ids.length) await native.cancel({ notifications: ids.map((id) => ({ id })) });
    } catch (err) {
      console.warn('notify cancel', err);
    }
  }
}

/**
 * @param {Array<{ race: object, matchedLanes?: object[], matchedAthletes?: string[] }>} followedItems
 */
export async function scheduleFollowedRaceNotifications(followedItems) {
  const prefs = loadNotifyPrefs();
  if (!prefs.enabled) {
    await cancelScheduledNotifications();
    return { scheduled: 0, reason: 'off' };
  }

  const native = capacitorNotifications();
  if (!native?.schedule) {
    return { scheduled: 0, reason: 'no-native' };
  }

  await cancelScheduledNotifications();

  const now = Date.now();
  const notifications = [];
  for (const item of followedItems || []) {
    const race = item.race;
    if (!race) continue;
    const dayDate = guessRaceCalendarDate(race);
    const at = fireAtForRace(race, dayDate);
    if (!at || at.getTime() <= now) continue;

    const who =
      (item.matchedLanes || [])
        .map((l) => l.clubCode || l.clubName)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ') ||
      (item.matchedAthletes || []).slice(0, 2).join(', ') ||
      item.matchLabel ||
      'Your follow';

    notifications.push({
      id: notificationIdForRace(race.id),
      title: 'Crew racing soon',
      body: `${who} · ${race.time} · ${race.eventType}`,
      schedule: { at },
      channelId: CHANNEL_ID,
      extra: { raceId: race.id },
    });
  }

  // Cap at 60 pending (Android practical limit for us)
  const batch = notifications.slice(0, 60);
  if (!batch.length) return { scheduled: 0, reason: 'none-upcoming' };

  try {
    await native.schedule({ notifications: batch });
    return { scheduled: batch.length, reason: 'ok' };
  } catch (err) {
    console.warn('notify schedule', err);
    return { scheduled: 0, reason: 'error', error: String(err?.message || err) };
  }
}

/** In-browser / foreground nudge when a race enters start blocks or live. */
export function maybeWebNotifyRace(race, phaseStatus, matchLabel) {
  const prefs = loadNotifyPrefs();
  if (!prefs.enabled) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (capacitorNotifications()) return; // native owns alerts
  if (phaseStatus !== 'start_blocks' && phaseStatus !== 'live') return;

  const key = `rnzWebNudge_${race.id}_${phaseStatus}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }

  const title = phaseStatus === 'live' ? 'Crew is racing' : 'Crew in start blocks';
  try {
    new Notification(title, {
      body: `${matchLabel || 'Follow'} · ${race.time} · ${race.eventType}`,
      tag: `rnz-${race.id}`,
    });
  } catch {
    /* ignore */
  }
}
