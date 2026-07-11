/** U19 selection trial format — Sat 18 July 2026, Big Manly Beach. */

export const TRIAL_DATE = 'Saturday 18 July 2026';
export const TRIAL_VENUE = 'Big Manly Beach';
export const TRIAL_LOCATION_NAME = 'Manly Sailing Club';
export const TRIAL_LAT = -36.628375;
export const TRIAL_LNG = 174.758363;
export const TRIAL_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${TRIAL_LAT},${TRIAL_LNG}`;
export const TRIAL_MAPS_ZOOM = 13;
export const TRIAL_MAPS_EMBED_URL = `https://maps.google.com/maps?q=${TRIAL_LAT},${TRIAL_LNG}&hl=en&z=${TRIAL_MAPS_ZOOM}&t=k&output=embed`;
export const CONTINGENCY_DATE = 'Sunday 19 July 2026';
export const ARRIVAL_TIME = '07:00';
export const BRIEFING_TIME = '07:40';
export const RACING_START = '08:30';
export const INTERVAL_MIN = 3;
export const SESSION2_TO_3_BREAK_MIN = 60;

/** Beach sprint boat class notation (U19 trial). */
export const BOAT_CJW1X = 'CJW1X';
export const BOAT_CJM1X = 'CJM1X';
export const BOAT_CJMix2X = 'CJMix2X';
export const BOAT_CJW2X = 'CJW2X';
export const BOAT_CJM2X = 'CJM2X';
export const BOAT_CLASSES = `${BOAT_CJW1X} ${BOAT_CJM1X} ${BOAT_CJW2X} ${BOAT_CJM2X} ${BOAT_CJMix2X}`;

/** Athletes ranked above this continue after Session 1 TT (women). W4 races Session 3 doubles only. */
export const WOMEN_SINGLES_CUT = 4;
/** Athletes ranked above this continue after Session 1 TT (men). M4 races Session 3 doubles only. */
export const MEN_SINGLES_CUT = 3;

export const U19_MEN = [
  { name: 'Arthur Crimmins', club: 'Tauranga Rowing Club' },
  { name: 'Guy Smith', club: '—' },
  { name: 'Henry Johnston', club: '—' },
  { name: 'Leonardo Bacchus', club: 'Takapuna Grammar Rowing Club' },
  { name: 'Jacob Haley', club: 'Canterbury Rowing Club / Cashmere High School' },
];

export const U19_WOMEN = [
  { name: 'Elizabeth Keddell', club: 'Petone Rowing Club' },
  { name: 'Emily Pengelly', club: 'Bay of Plenty Coast Rowing Club' },
  { name: 'Tallulah Kubaisi-Gallagher', club: 'Bay of Plenty Coast Rowing Club' },
  { name: 'Millie Brooks', club: 'Avon / Cashmere High School' },
  { name: 'Sophie Harrison', club: 'Bay of Plenty Coast / Aquinas College' },
  { name: 'Hazel Church', club: 'Waikato Rowing Club / St Paul\'s Collegiate School' },
];

/** Fixed solo reference crews repeated every Session 2 run (@ 3 min intervals). */
export const SESSION2_FIXED = {
  w1Single: `W1 — ${BOAT_CJW1X} (solo TT)`,
  m1Single: `M1 — ${BOAT_CJM1X} (solo TT)`,
};

/** Session 2 — CJMix2X H2H among W2/W3 × M2/M3 only (ranks 1–3 per gender; W1/M1 solo refs). */
export const MIX2X_MATRIX_RUNS = [
  { run: 1, h2h: [{ crew: 'M2 + W2', vs: 'M3 + W3' }] },
  { run: 2, h2h: [{ crew: 'M2 + W3', vs: 'M3 + W2' }] },
];

/** Session 3 — processional doubles speed trial (@ 3 min). Selectors assess CJW2X / CJM2X viability. */
export const SESSION3_DOUBLES_TT = [
  { order: 1, crew: `${BOAT_CJMix2X} — selected Session 2 pair`, label: BOAT_CJMix2X },
  { order: 2, crew: 'W3 + W4', label: `${BOAT_CJW2X} test` },
  { order: 3, crew: 'M3 + M4', label: `${BOAT_CJM2X} test` },
];

export const LOWER_RANKED_SOLO_ELIMINATED =
  'W5, W6 and M5 do not continue after Session 1. Publish ranking board: W1–W4 and M1–M4 remain; W1–W3 and M1–M3 race Session 2 mix. W4 and M4 are eligible for Session 3 doubles (W3+W4, M3+M4).';

/** Six-athlete solo knockout (women). */
export function singlesKnockoutBracket(prefix = 'M') {
  const p = prefix;
  return {
    playIn: [
      { id: `${p}P1`, seedA: 3, seedB: 6, label: '3 vs 6' },
      { id: `${p}P2`, seedA: 4, seedB: 5, label: '4 vs 5' },
    ],
    semiFinals: [
      { id: `${p}SF1`, seedA: 1, seedB: `W(${p}P1)`, label: '1 vs winner (3 v 6)' },
      { id: `${p}SF2`, seedA: 2, seedB: `W(${p}P2)`, label: '2 vs winner (4 v 5)' },
    ],
    final: { id: `${p}F`, label: `Final — ${prefix === 'W' ? BOAT_CJW1X : BOAT_CJM1X} winner` },
    bronze: { id: `${p}B`, label: 'Bronze (optional, time permitting)' },
  };
}

/** Five-athlete solo knockout (men). */
export function singlesKnockoutBracketFive(prefix = 'M') {
  const p = prefix;
  return {
    playIn: [{ id: `${p}P1`, seedA: 4, seedB: 5, label: '4 vs 5' }],
    semiFinals: [
      { id: `${p}SF1`, seedA: 1, seedB: 3, label: '1 vs 3' },
      { id: `${p}SF2`, seedA: 2, seedB: `W(${p}P1)`, label: '2 vs winner (4 v 5)' },
    ],
    final: { id: `${p}F`, label: `Final — ${prefix === 'W' ? BOAT_CJW1X : BOAT_CJM1X} winner` },
    bronze: { id: `${p}B`, label: 'Bronze (optional, time permitting)' },
  };
}

export function womenKnockoutBracket() {
  return singlesKnockoutBracket('W');
}

export function menKnockoutBracket() {
  return U19_MEN.length >= 6 ? singlesKnockoutBracket('M') : singlesKnockoutBracketFive('M');
}

export function buildSchedule() {
  const menCount = U19_MEN.length;
  return [
    { time: ARRIVAL_TIME, block: 'Arrival', detail: `${TRIAL_VENUE} — help set up boats, sign-in, rig check (David Vallance + volunteers).` },
    { time: BRIEFING_TIME, block: 'Briefing', detail: 'Safety and trial overview for all athletes and volunteers.' },
    { time: RACING_START, block: 'Session 1 — Solo', detail: `Women's TT → men's TT → women's knockout → men's knockout (${BOAT_CJW1X} & ${BOAT_CJM1X}).` },
    { time: RACING_START, block: `${BOAT_CJW1X} time trial`, detail: '6 starts @ 3 min — women ranked W1–W6 (fastest = W1).' },
    { time: '08:50', block: `${BOAT_CJM1X} time trial`, detail: `${menCount} starts @ 3 min — men ranked M1–M${menCount} (fastest = M1).` },
    { time: '09:10', block: `${BOAT_CJW1X} knockout`, detail: 'Play-in W3vW6 & W4vW5 → semis → final (bronze optional). W1 & W2 byes to semis.' },
    { time: '09:35', block: `${BOAT_CJM1X} knockout`, detail: 'Play-in M4vM5 → semis (M1vM3, M2v play-in winner) → final (bronze optional).' },
    { time: '10:10', block: 'Lower ranked solo eliminated', detail: LOWER_RANKED_SOLO_ELIMINATED },
    { time: '10:20', block: 'Session 1 complete', detail: `${BOAT_CJW1X} and ${BOAT_CJM1X} from knockout; ~1 hr recovery break.` },
    { time: '11:20', block: `Session 2 — ${BOAT_CJMix2X} matrix`, detail: 'Two runs: W1/M1 solo refs, then mix H2H among W2/W3 × M2/M3 only.' },
    { time: '11:25', block: 'Matrix run 1', detail: 'W1 + M1 refs → M2+W2 vs M3+W3.' },
    { time: '11:45', block: 'Matrix run 2', detail: 'W1 + M1 refs → M2+W3 vs M3+W2.' },
    { time: '12:05', block: 'Session 2 complete', detail: 'Selectors score mix matrix; ~1 hr recovery break before doubles speed trial.' },
    { time: '13:05', block: 'Session 3 — Doubles speed trial', detail: `Processional @ 3 min: ${BOAT_CJMix2X}, then W3+W4, then M3+M4 — assess whether doubles are fast enough.` },
    { time: '13:05', block: 'Doubles TT start 1', detail: `${BOAT_CJMix2X} — selected Session 2 pair.` },
    { time: '13:08', block: 'Doubles TT start 2', detail: `W3 + W4 — ${BOAT_CJW2X} speed test.` },
    { time: '13:11', block: 'Doubles TT start 3', detail: `M3 + M4 — ${BOAT_CJM2X} speed test.` },
    { time: '13:20', block: 'Debrief', detail: 'Selection panel review; provisional crew announcements.' },
  ];
}

export function buildDaySheetSchedule() {
  const menCount = U19_MEN.length;
  return [
    { time: ARRIVAL_TIME, activity: 'Arrive at beach', note: 'Help set up boats · sign-in · rig check' },
    { time: BRIEFING_TIME, activity: 'Briefing', note: 'Safety · trial overview · warm-up' },
    { time: RACING_START, activity: `${BOAT_CJW1X} time trial`, note: '6 starts @ 3 min — rank W1–W6' },
    { time: '08:50', activity: `${BOAT_CJM1X} time trial`, note: `${menCount} starts @ 3 min — rank M1–M${menCount}` },
    { time: '09:10', activity: `${BOAT_CJW1X} knockout`, note: '3v6 · 4v5 play-in → semis → final' },
    { time: '09:35', activity: `${BOAT_CJM1X} knockout`, note: '4v5 play-in → M1vM3 / M2v winner → final' },
    { time: '10:10', activity: 'Lower ranked solo eliminated', note: 'W5/W6 & M5 out · W1–W4 & M1–M4 remain' },
    { time: '10:20', activity: 'Break (~1 hr)', note: `Publish ranking board · ${BOAT_CJW1X}/${BOAT_CJM1X} confirmed` },
    { time: '11:20', activity: 'Session 2 — Mix run 1', note: 'W1 + M1 refs → M2+W2 vs M3+W3' },
    { time: '11:45', activity: 'Session 2 — Mix run 2', note: 'W1 + M1 refs → M2+W3 vs M3+W2' },
    { time: '12:05', activity: 'Break (~1 hr)', note: 'Selectors score mix matrix' },
    { time: '13:05', activity: 'Doubles speed trial', note: `${BOAT_CJMix2X} → W3+W4 → M3+M4 (@ 3 min)` },
    { time: '13:20', activity: 'Debrief', note: 'Selection panel · provisional announcements' },
  ];
}

/** Athlete-facing schedule — no seat swaps, ranks, or progression detail. */
export function buildAthleteRunSheetSchedule() {
  return [
    { time: ARRIVAL_TIME, activity: 'Arrive at beach', note: 'Help set up boats · sign-in · rig check' },
    { time: BRIEFING_TIME, activity: 'Briefing', note: 'Safety · trial overview · warm-up' },
    { time: RACING_START, activity: "Women's solo — time trial", note: BOAT_CJW1X },
    { time: '08:50', activity: "Men's solo — time trial", note: BOAT_CJM1X },
    { time: '09:10', activity: "Women's solo — knockout", note: `${BOAT_CJW1X} racing` },
    { time: '09:35', activity: "Men's solo — knockout", note: `${BOAT_CJM1X} racing` },
    { time: '10:20', activity: 'Break', note: 'Recovery · hydration · shade (~1 hr)' },
    { time: '11:20', activity: `Session 2 — ${BOAT_CJMix2X}`, note: `${BOAT_CJMix2X} racing` },
    { time: '12:05', activity: 'Break', note: 'Recovery (~1 hr)' },
    { time: '13:05', activity: 'Session 3 — Doubles', note: 'Doubles speed trial' },
    { time: '13:20', activity: 'Debrief', note: 'Wrap-up · selectors available for questions' },
  ];
}

export const ATHLETE_RUN_SHEET_REMINDERS = [
  'Arrive by 07:00 to help set up boats at Big Manly Beach.',
  'Compulsory pre-selection camp: 4–5 Jul (Orewa).',
  'Self-funded transport, food, and accommodation.',
  'Bring: food, warm clothes, water, change of clothes, sun protection, and race kit.',
  `Weather contingency: ${CONTINGENCY_DATE}.`,
];

export const DAY_SHEET_ROLES = [
  { role: 'Selection panel', who: 'John (on site) · Justin & Megan (online)' },
  { role: 'Trial manager', who: 'Mike — logistics, comms, results' },
  { role: 'Support', who: 'David Vallance + volunteers' },
];

/** Recommended-format disclaimer — selectors may amend the plan on the day. */
export const SELECTOR_DISCLAIMER =
  'This document sets out a recommended trial format for selector review, not a fixed protocol. The selection panel and trial manager retain authority to amend the schedule, racing structure, and selection process on the day to reflect weather, conditions, athlete availability, and selection requirements.';

export const LOGIC_REVIEW = [
  {
    title: 'Athlete numbers fit the format',
    ok: true,
    text: 'Six women and five men (K. Goonan withdrawn). After Session 1, lower ranked solo (W5, W6, M5) are eliminated. W1–W3 and M1–M3 race the mix matrix; W4 and M4 remain for Session 3 doubles speed trial with W3 and M3.',
  },
  {
    title: 'Session 1 solo — time trial and knockout',
    ok: true,
    text: `Running order: women's time trial, men's time trial, women's knockout, men's knockout. Women: six-athlete TT then knockout (play-in 3v6 and 4v5; seeds 1–2 bye to semis). Men: five-athlete TT then knockout (play-in 4v5; M1 v M3 and M2 v play-in winner in semis). ${BOAT_CJW1X} and ${BOAT_CJM1X} from knockout winners. TT ranks carry forward as Wx/Mx labels.`,
  },
  {
    title: 'Lower ranked solo eliminated',
    ok: true,
    text: 'After Session 1 knockouts, W5, W6 and M5 do not continue. M4 is not eliminated from solo. W4 and M4 remain eligible for Session 3 doubles (W3+W4 and M3+M4 speed trial); only W1–W3 and M1–M3 race Session 2.',
  },
  {
    title: 'Session 2 matrix — top three only',
    ok: true,
    text: `Each run opens with W1 and M1 solo as fixed references, then one mix H2H (run 1: M2+W2 vs M3+W3; run 2: M2+W3 vs M3+W2). ${BOAT_CJMix2X} selected from the two H2H results vs W1/M1 refs.`,
  },
  {
    title: 'Session 3 — doubles speed trial',
    ok: true,
    text: `One processional block @ 3 min: selected ${BOAT_CJMix2X}, then W3+W4, then M3+M4. Selectors assess whether ${BOAT_CJW2X} and ${BOAT_CJM2X} are fast enough alongside confirmed ${BOAT_CJMix2X}. No further matrix rounds.`,
  },
  {
    title: 'Rest between sessions',
    ok: true,
    text: 'One hour between Sessions 1 and 2, and between Session 2 and Session 3. Hydration, shade, and boat swaps in the breaks.',
  },
  {
    title: 'Rank labels follow Session 1 TT',
    ok: true,
    text: 'Wx/Mx labels always refer to Session 1 time-trial rank (fastest = 1), not nomination seeding. Publish a visible ranking board after lower ranked solo are eliminated at 10:10.',
  },
];
