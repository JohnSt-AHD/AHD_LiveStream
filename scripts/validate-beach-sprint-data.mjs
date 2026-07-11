#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyGroupRecommendationCap,
  assessAthlete,
  assessCoxswainRegattaScore,
  buildC1XNationalsTables,
  buildCoxswainNominees,
  coxRegattaFromResults,
  isCoxswainNominee,
  loadNationalsIndex,
  loadTrialAthletes,
  nationalsForAthlete,
  northIslandForAthlete,
  loadCnibAthleteDirectory,
} from './lib/beach-sprint-selection.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_DIR = 'C:/Users/JohnSt/Desktop/RNZ/Beach Sprints/Dev Trial Info';
const ARCHIVE_DIR = join(__dirname, '..', 'public', 'data', 'archives', 'cnzb2026', 'latest');

async function assessAll(athletes, index, cnibDirectory) {
  const assessed = [];
  for (const athlete of athletes) {
    const nationals = nationalsForAthlete(athlete, index);
    const northIsland = await northIslandForAthlete(athlete, cnibDirectory);
    const entry = assessAthlete(athlete, nationals, northIsland);
    if (isCoxswainNominee(entry)) {
      const { nationals: coxNationals, northIsland: coxNorthIsland } = coxRegattaFromResults(
        entry,
        nationals,
        northIsland,
      );
      entry.coxNationals = coxNationals;
      entry.coxNorthIsland = coxNorthIsland;
      entry.coxScoring = assessCoxswainRegattaScore(coxNationals, coxNorthIsland);
    }
    assessed.push(entry);
  }
  applyGroupRecommendationCap(assessed);
  return assessed;
}

async function main() {
  const trialCsv = join(DEV_DIR, 'AthleteStats (3).csv');
  const athletes = await loadTrialAthletes(trialCsv);
  const cnibDirectory = await loadCnibAthleteDirectory();

  const [archiveIndex, localIndex] = await Promise.all([
    loadNationalsIndex({ dir: ARCHIVE_DIR }),
    loadNationalsIndex({ dir: DEV_DIR }),
  ]);

  console.log('CNZB row counts');
  console.log('  Archive competitors:', archiveIndex.competitors.length);
  console.log('  Local competitors:  ', localIndex.competitors.length);
  console.log('  Archive results:    ', archiveIndex.results.length);
  console.log('  Local results:      ', localIndex.results.length);

  const archiveAssessed = await assessAll(athletes, archiveIndex, cnibDirectory);
  const localAssessed = await assessAll(athletes, localIndex, cnibDirectory);

  const byName = (list) => new Map(list.map((a) => [a.fullName, a]));
  const archiveMap = byName(archiveAssessed);
  const localMap = byName(localAssessed);

  const diffs = [];
  for (const athlete of athletes) {
    const a = archiveMap.get(athlete.fullName);
    const l = localMap.get(athlete.fullName);
    if (!a || !l) continue;
    if (a.nationals.summary !== l.nationals.summary || a.scoring.total !== l.scoring.total) {
      diffs.push({
        name: athlete.fullName,
        archiveSummary: a.nationals.summary,
        localSummary: l.nationals.summary,
        archiveScore: a.scoring.total,
        localScore: l.scoring.total,
      });
    }
  }

  console.log('\nNominee CNZB summary / score differences (archive vs local CSVs):');
  if (!diffs.length) console.log('  None — local files match archive for all nominees.');
  else diffs.forEach((d) => console.log(`  ${d.name}: ${d.archiveSummary} (${d.archiveScore}) -> ${d.localSummary} (${d.localScore})`));

  console.log('\nLocal CSV — key trial nominees:');
  const keyNames = [
    'Arthur Crimmins',
    'Leonardo Bacchus',
    'Guy Smith',
    'Henry Johnston',
    'Emily Pengelly',
    'Tallulah Kubaisi-Gallagher',
    'Elizabeth Keddell',
    'Coby Goode',
    'Holly Chaafe',
    'Liam Collins',
    'Jacob Haley',
    'Millie Brooks',
    'Kaine Goonan',
    'Ryan Slater',
    'Hazel Church',
  ];
  for (const name of keyNames) {
    const a = localMap.get(name);
    if (!a) {
      console.log(`  ${name}: NOT FOUND`);
      continue;
    }
    const cox =
      a.coxScoring != null
        ? ` | cox ${a.coxScoring.total} (${a.coxNationals?.summary || '—'})`
        : '';
    console.log(`  ${name}: ${a.scoring.total.toFixed(1)} — ${a.nationals.summary}${cox}`);
  }

  const c1x = buildC1XNationalsTables(localIndex, localAssessed);
  const gu18 = c1x.find((t) => t.id === 'gu18');
  console.log('\nG U18 C1X top 8 (local data):');
  gu18?.standings.slice(0, 8).forEach((r) => {
    console.log(`  ${r.rank}. ${r.name} — ${r.note}${r.time ? ` ${r.time}` : ''}${r.nominated ? ' [nominee]' : ''}`);
  });

  const mopn = c1x.find((t) => t.id === 'mopn');
  const wopn = c1x.find((t) => t.id === 'wopn');
  console.log('\nM Open C1X standings (A/B finals):');
  mopn?.standings.forEach((r) => console.log(`  ${r.rank}. ${r.name} — ${r.note}${r.time ? ` ${r.time}` : ''}`));
  console.log('\nW Open C1X standings (A/B finals):');
  wopn?.standings.forEach((r) => console.log(`  ${r.rank}. ${r.name} — ${r.note}${r.time ? ` ${r.time}` : ''}`));

  const coby = localMap.get('Coby Goode');
  const holly = localMap.get('Holly Chaafe');
  const cobyRank = mopn?.standings.find((r) => r.name.includes('Coby'));
  const hollyRank = wopn?.standings.find((r) => r.name.includes('Holly'));
  const abErrors = [];
  if (!coby?.nationals.summary?.includes('B Final (2nd)')) {
    abErrors.push(`Coby summary: expected B Final (2nd), got "${coby?.nationals.summary}"`);
  }
  if (cobyRank?.rank !== 4) abErrors.push(`Coby overall rank: expected 4, got ${cobyRank?.rank}`);
  if (!holly?.nationals.summary?.includes('B Final (1st)')) {
    abErrors.push(`Holly summary: expected B Final (1st), got "${holly?.nationals.summary}"`);
  }
  if (hollyRank?.rank !== 3) abErrors.push(`Holly overall rank: expected 3, got ${hollyRank?.rank}`);
  console.log('\nA/B final consistency:');
  if (!abErrors.length) console.log('  OK — Coby (4th, B-final 2nd) and Holly (3rd, B-final winner).');
  else abErrors.forEach((e) => console.log(`  FAIL: ${e}`));

  const cox = buildCoxswainNominees(localAssessed);
  console.log('\nSuggested cox (local data):');
  console.log('  Male:  ', cox.recommendedMale?.fullName, cox.recommendedMale?.coxScoring?.total);
  console.log('  Female:', cox.recommendedFemale?.fullName, cox.recommendedFemale?.coxScoring?.total);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
