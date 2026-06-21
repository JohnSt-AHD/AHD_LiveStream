#!/usr/bin/env node
/**
 * Regenerate all CrewSight proposal PDFs at $10/SIM/month in docs/proposals/sim-10.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ARGS = ['--sim-month=10', '--out-dir=docs/proposals/sim-10'];
const SCRIPTS = [
  'generate-kri-proposal-pdfs.mjs',
  'generate-crewsight-roadmap-pdf.mjs',
  'generate-crewsight-comparison-pdf.mjs',
];

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, script), ...ARGS], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

for (const script of SCRIPTS) {
  await run(script);
}
