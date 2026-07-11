/**
 * Per-regatta 1-page results summaries from RowIT.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEventPodiums,
  collectStandouts,
  headlineTypesFromEvents,
  isCoastalHeadlineEvent,
  isPremOpenEvent,
  isSchoolsHeadlineEvent,
  loadCnzbIndex,
  loadRegattaIndex,
  selectFlagshipPodiums,
} from './season-results-summary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARCHIVES = join(__dirname, '..', '..', 'public', 'data', 'archives');

const SCHOOLS_HEADLINE = [
  'B U18 1X',
  'G U18 1X',
  'B U18 2X',
  'G U18 2X',
  'B U18 4X+',
  'G U18 4X+',
  'B U18 8+',
  'G U18 8+',
];

const CLASSIC_HEADLINE = [
  'M Prm 1X',
  'W Prm 1X',
  'M Prm 2-',
  'W Prm 2-',
  'M Prm 2X',
  'W Prm 2X',
  'M Prm 4-',
  'W Prm 4-',
  'M Prm 4X-',
  'W Prm 4X-',
];

const COASTAL_HEADLINE = [
  'B U18 C1X',
  'G U18 C1X',
  'M Opn C1X',
  'W Opn C1X',
  'Mx Opn C2X',
  'Mx Opn C4X+',
];

/** @type {import('./regatta-summary.mjs').RegattaConfig[]} */
export const REGATTA_CONFIGS = [
  {
    code: 'nicc2026',
    label: 'North Island Championships 2026',
    shortLabel: 'NICC 2026',
    type: 'classic',
    dir: join(ARCHIVES, 'nicc2026', 'latest'),
    scrape: true,
    headline: CLASSIC_HEADLINE,
    eventFilter: (ev) => isPremOpenEvent(ev),
  },
  {
    code: 'nzcc2026',
    label: 'NZ Club Champs 2026',
    shortLabel: 'NZCC 2026',
    type: 'classic',
    dir: join(ARCHIVES, 'nzcc2026', 'latest'),
    scrape: true,
    optional: true,
    headline: CLASSIC_HEADLINE,
    eventFilter: (ev) => isPremOpenEvent(ev),
  },
  {
    code: 'niss2026',
    label: 'North Island Secondary Schools 2026',
    shortLabel: 'NISS 2026',
    type: 'schools',
    dir: join(ARCHIVES, 'niss2026', 'latest'),
    scrape: true,
    headline: SCHOOLS_HEADLINE,
    eventFilter: (ev) => isSchoolsHeadlineEvent(ev),
  },
  {
    code: 'siss2026',
    label: 'South Island Secondary Schools 2026',
    shortLabel: 'SISS 2026',
    type: 'schools',
    dir: join(ARCHIVES, 'siss2026', 'latest'),
    scrape: true,
    headline: SCHOOLS_HEADLINE,
    eventFilter: (ev) => isSchoolsHeadlineEvent(ev),
  },
  {
    code: 'mads2026',
    label: 'Maadi Cup 2026',
    shortLabel: 'Maadi 2026',
    type: 'schools',
    dir: join(ARCHIVES, 'mads2026', 'latest'),
    scrape: true,
    headline: SCHOOLS_HEADLINE,
    eventFilter: (ev) => isSchoolsHeadlineEvent(ev),
  },
  {
    code: 'cnzb2026',
    label: 'NZ Coastal Beach Sprint Champs 2026',
    shortLabel: 'CNZB 2026',
    type: 'coastal',
    loader: 'cnzb',
    headline: COASTAL_HEADLINE,
    eventFilter: (ev) => isCoastalHeadlineEvent(ev),
  },
  {
    code: 'cnib2026',
    label: 'Coastal North Island Champs 2026',
    shortLabel: 'CNIB 2026',
    type: 'coastal',
    scrape: true,
    headline: COASTAL_HEADLINE,
    eventFilter: (ev) => isCoastalHeadlineEvent(ev),
  },
  {
    code: 'crsb2026r1',
    label: 'Coastal Regional Series 2026 — Round 1',
    shortLabel: 'CRSB R1',
    type: 'coastal',
    scrape: true,
    optional: true,
    headline: COASTAL_HEADLINE,
    eventFilter: (ev) => isCoastalHeadlineEvent(ev),
  },
  {
    code: 'crsb2026r2',
    label: 'Coastal Regional Series 2026 — Round 2',
    shortLabel: 'CRSB R2',
    type: 'coastal',
    scrape: true,
    optional: true,
    headline: COASTAL_HEADLINE,
    eventFilter: (ev) => isCoastalHeadlineEvent(ev),
  },
  {
    code: 'crsb2026r3',
    label: 'Coastal Regional Series 2026 — Round 3',
    shortLabel: 'CRSB R3',
    type: 'coastal',
    scrape: true,
    optional: true,
    headline: COASTAL_HEADLINE,
    eventFilter: (ev) => isCoastalHeadlineEvent(ev),
  },
  {
    code: 'crsb2026r4',
    label: 'Coastal Regional Series 2026 — Round 4',
    shortLabel: 'CRSB R4',
    type: 'coastal',
    scrape: true,
    optional: true,
    headline: COASTAL_HEADLINE,
    eventFilter: (ev) => isCoastalHeadlineEvent(ev),
  },
];

function pickHeadlineTypes(index, config) {
  const fromEvents = headlineTypesFromEvents(index.events, (ev) => config.eventFilter(ev));
  const wanted = config.headline || [];
  const merged = [...wanted];
  for (const t of fromEvents) {
    if (!merged.includes(t)) merged.push(t);
  }
  return merged.slice(0, 12);
}

export async function buildRegattaSummary(config) {
  let index;
  let loadError = null;

  try {
    if (config.loader === 'cnzb') {
      index = await loadCnzbIndex();
    } else {
      index = await loadRegattaIndex({
        ...config,
        label: config.shortLabel || config.label,
      });
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    return {
      code: config.code,
      label: config.label,
      shortLabel: config.shortLabel,
      type: config.type,
      error: loadError,
      headline: [],
      standouts: [],
      stats: { events: 0, finals: 0 },
      generatedAt: new Date().toISOString(),
    };
  }

  const filter = (ev, comp, idx) => config.eventFilter(ev, comp, idx || index);
  const allPodiums = buildEventPodiums(index, { eventFilter: filter });
  const headlineTypes = pickHeadlineTypes(index, config);
  let headline = selectFlagshipPodiums(allPodiums, headlineTypes);

  if (!headline.length) {
    headline = allPodiums
      .filter((p) => p.finalTier === 'A' || p.finalLabel.startsWith('A'))
      .slice(0, 10);
  }

  const standouts = collectStandouts(allPodiums, { discipline: config.type }).map((s) => ({
    ...s,
    highlights: s.highlights.map((h) => h.replace(`${index.regatta}: `, '')),
  }));

  return {
    code: config.code,
    label: config.label,
    shortLabel: config.shortLabel,
    type: config.type,
    regatta: index.regatta,
    headline,
    standouts,
    stats: {
      events: index.events.size,
      finals: allPodiums.length,
      resultsRaces: index.results.length,
    },
    note:
      allPodiums.length === 0
        ? 'No A-final results found on RowIT for this regatta yet.'
        : undefined,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildAllRegattaSummaries(codes = REGATTA_CONFIGS.map((c) => c.code)) {
  const out = [];
  for (const code of codes) {
    const config = REGATTA_CONFIGS.find((c) => c.code === code);
    if (!config) continue;
    process.stdout.write(`  ${code}… `);
    const summary = await buildRegattaSummary(config);
    console.log(summary.error ? `skip (${summary.error})` : `${summary.stats.finals} finals`);
    out.push(summary);
  }
  return out;
}
