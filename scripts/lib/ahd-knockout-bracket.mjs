/** Static AHD / Beach Sprints regatta knockout tree markup (matches beachsprints-regatta.css). */

export const KNOCKOUT_TREE_CSS = `
:root {
  --bsr-bg: #082f42;
  --bsr-bg-deep: #061e2a;
  --bsr-panel: rgba(6, 40, 58, 0.94);
  --bsr-border: rgba(45, 212, 191, 0.35);
  --bsr-text: #e8f4fc;
  --bsr-muted: #9ec4d8;
  --bsr-accent: #f97316;
  --bsr-sand: #fde68a;
  --bsr-teal: #2dd4bf;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 20px 24px 28px;
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: linear-gradient(165deg, var(--bsr-bg-deep) 0%, var(--bsr-bg) 45%, #0a3d52 100%);
  color: var(--bsr-text);
}
.bsr-bracket-title {
  margin: 0 0 6px;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--bsr-sand);
}
.bsr-bracket-sub {
  margin: 0 0 16px;
  font-size: 0.78rem;
  color: var(--bsr-muted);
}
.bsr-knockout-tree {
  display: flex;
  align-items: stretch;
  gap: 0;
  min-width: min(100%, 880px);
}
.bsr-tree-col {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 160px;
  padding: 0 28px 0 0;
  position: relative;
}
.bsr-tree-col:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 2.4rem;
  right: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, transparent, var(--bsr-teal) 8%, var(--bsr-teal) 92%, transparent);
  opacity: 0.45;
}
.bsr-tree-col-title {
  margin: 0 0 14px;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--bsr-sand);
  text-align: center;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--bsr-accent);
}
.bsr-tree-col--winner .bsr-tree-col-title { color: var(--bsr-accent); }
.bsr-tree-col-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: space-around;
  gap: 4px;
  min-height: 200px;
}
.bsr-tree-col--winner .bsr-tree-col-body {
  align-items: center;
  justify-content: center;
}
.bsr-tree-feeder {
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  flex: 1;
  position: relative;
  padding-right: 22px;
  margin: 6px 0;
}
.bsr-tree-feeder--pair::before {
  content: '';
  position: absolute;
  right: 0;
  top: 18%;
  bottom: 18%;
  width: 2px;
  background: var(--bsr-teal);
  border-radius: 1px;
}
.bsr-tree-feeder--pair::after {
  content: '';
  position: absolute;
  right: -22px;
  top: 50%;
  width: 22px;
  height: 2px;
  background: var(--bsr-teal);
  transform: translateY(-50%);
}
.bsr-tree-match-row {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  padding: 4px 0;
}
.bsr-tree-match-row::after {
  content: '';
  position: absolute;
  right: -22px;
  top: 50%;
  width: 22px;
  height: 2px;
  background: var(--bsr-teal);
  transform: translateY(-50%);
}
.bsr-tree-feeder--pair .bsr-tree-match-row::after { width: 0; }
.bsr-tree-col--final .bsr-tree-feeder::before,
.bsr-tree-col--final .bsr-tree-feeder::after,
.bsr-tree-col--final .bsr-tree-match-row::after,
.bsr-tree-col--winner .bsr-tree-feeder::before,
.bsr-tree-col--winner .bsr-tree-feeder::after,
.bsr-tree-col--winner .bsr-tree-match-row::after { display: none; }
.bsr-tree-match {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 140px;
  max-width: 200px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid var(--bsr-border);
  border-radius: 8px;
  text-align: left;
}
.bsr-tree-match-meta {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--bsr-muted);
  margin-bottom: 2px;
}
.bsr-tree-crew {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 0.8rem;
  line-height: 1.2;
}
.bsr-tree-crew--tbd { opacity: 0.55; font-style: italic; color: var(--bsr-muted); }
.bsr-tree-seed {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(45, 212, 191, 0.2);
  border: 1px solid var(--bsr-teal);
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--bsr-sand);
  flex-shrink: 0;
}
.bsr-tree-seed--bye { background: rgba(249, 115, 22, 0.2); border-color: var(--bsr-accent); }
.bsr-tree-crew-name { flex: 1; min-width: 0; font-weight: 600; color: var(--bsr-text); }
.bsr-tree-champion {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 12px;
  text-align: center;
  background: rgba(249, 115, 22, 0.12);
  border: 2px solid var(--bsr-accent);
  border-radius: 12px;
  min-width: 120px;
}
.bsr-tree-champion-badge {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: 2px dashed var(--bsr-border);
  font-size: 1.4rem;
}
.bsr-tree-champion-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--bsr-sand);
  line-height: 1.25;
}
.bsr-tree-champion-sub {
  font-size: 0.72rem;
  color: var(--bsr-teal);
}
.bsr-bracket-footnote {
  margin-top: 12px;
  font-size: 0.72rem;
  color: var(--bsr-muted);
}
`;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderCrew(seed, label, { tbd = false, bye = false } = {}) {
  const seedCls = bye ? ' bsr-tree-seed--bye' : '';
  const crewCls = tbd ? ' bsr-tree-crew--tbd' : '';
  return (
    `<span class="bsr-tree-crew${crewCls}">` +
    `<span class="bsr-tree-seed${seedCls}">${esc(seed)}</span>` +
    `<span class="bsr-tree-crew-name">${esc(label)}</span>` +
    `</span>`
  );
}

function renderMatch(label, crewA, crewB) {
  return (
    `<div class="bsr-tree-match">` +
    `<span class="bsr-tree-match-meta">${esc(label)}</span>` +
    renderCrew(crewA.seed, crewA.label, crewA.opts) +
    renderCrew(crewB.seed, crewB.label, crewB.opts) +
    `</div>`
  );
}

function renderFeeder(matches, { pair = false } = {}) {
  const rows = matches
    .map((m) => `<div class="bsr-tree-match-row">${renderMatch(m.label, m.a, m.b)}</div>`)
    .join('');
  const pairClass = pair ? ' bsr-tree-feeder--pair' : '';
  return `<div class="bsr-tree-feeder${pairClass}">${rows}</div>`;
}

function renderColumn(title, bodyHtml, extraClass = '') {
  return (
    `<div class="bsr-tree-col${extraClass ? ` ${extraClass}` : ''}">` +
    `<h3 class="bsr-tree-col-title">${esc(title)}</h3>` +
    `<div class="bsr-tree-col-body">${bodyHtml}</div>` +
    `</div>`
  );
}

function renderChampion(title, subtitle) {
  return (
    `<div class="bsr-tree-champion">` +
    `<div class="bsr-tree-champion-badge">🏆</div>` +
    `<span class="bsr-tree-champion-name">${esc(title)}</span>` +
    (subtitle ? `<span class="bsr-tree-champion-sub">${esc(subtitle)}</span>` : '') +
    `</div>`
  );
}

/** JW1x knockout tree — 4 athletes, seeds from time trial. */
export function buildWomenTrialKnockoutTree() {
  const sf =
    renderFeeder([
      {
        label: 'WSF1',
        a: { seed: 1, label: 'W1' },
        b: { seed: 4, label: 'W4' },
      },
    ]) +
    renderFeeder([
      {
        label: 'WSF2',
        a: { seed: 2, label: 'W2' },
        b: { seed: 3, label: 'W3' },
      },
    ]);
  const fin = renderFeeder([
    {
      label: 'WF — Final',
      a: { seed: '·', label: 'WSF1 winner', opts: { tbd: true } },
      b: { seed: '·', label: 'WSF2 winner', opts: { tbd: true } },
    },
  ]);
  const win = renderChampion('JW1x', 'Trial selection');
  return (
    `<div class="bsr-knockout-tree">` +
    renderColumn('Semi-finals', sf, 'bsr-tree-col--sf') +
    renderColumn('Final', fin, 'bsr-tree-col--final') +
    renderColumn('Winner', win, 'bsr-tree-col--winner') +
    `</div>`
  );
}

/** JM1x knockout tree — 6 athletes, play-in then semis. */
export function buildMenTrialKnockoutTree() {
  const playIn =
    renderFeeder([
      {
        label: 'MP1',
        a: { seed: 3, label: 'M3' },
        b: { seed: 6, label: 'M6' },
      },
    ]) +
    renderFeeder([
      {
        label: 'MP2',
        a: { seed: 4, label: 'M4' },
        b: { seed: 5, label: 'M5' },
      },
    ]);
  const sf =
    renderFeeder([
      {
        label: 'MSF1',
        a: { seed: 1, label: 'M1', opts: { bye: true } },
        b: { seed: '·', label: 'MP1 winner', opts: { tbd: true } },
      },
    ]) +
    renderFeeder([
      {
        label: 'MSF2',
        a: { seed: 2, label: 'M2', opts: { bye: true } },
        b: { seed: '·', label: 'MP2 winner', opts: { tbd: true } },
      },
    ]);
  const fin = renderFeeder([
    {
      label: 'MF — Final',
      a: { seed: '·', label: 'MSF1 winner', opts: { tbd: true } },
      b: { seed: '·', label: 'MSF2 winner', opts: { tbd: true } },
    },
  ]);
  const win = renderChampion('JM1x', 'Trial selection');
  return (
    `<div class="bsr-knockout-tree">` +
    renderColumn('Play-in', playIn, 'bsr-tree-col--rep') +
    renderColumn('Semi-finals', sf, 'bsr-tree-col--sf') +
    renderColumn('Final', fin, 'bsr-tree-col--final') +
    renderColumn('Winner', win, 'bsr-tree-col--winner') +
    `</div>`
  );
}

export function buildBracketScreenshotHtml({ title, subtitle, treeHtml, footnote }) {
  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>${KNOCKOUT_TREE_CSS}</style>
</head>
<body>
  <h1 class="bsr-bracket-title">${esc(title)}</h1>
  ${subtitle ? `<p class="bsr-bracket-sub">${esc(subtitle)}</p>` : ''}
  <div id="bracket-root">${treeHtml}</div>
  ${footnote ? `<p class="bsr-bracket-footnote">${esc(footnote)}</p>` : ''}
</body>
</html>`;
}
