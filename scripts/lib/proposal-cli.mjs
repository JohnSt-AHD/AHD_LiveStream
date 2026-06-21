import { join } from 'node:path';

export const DEFAULT_PROPOSALS_DIR = join('docs', 'proposals');

/**
 * @param {string} root Repo root (parent of scripts/)
 * @returns {{ simMonth: number, outDir: string, skipDrive: boolean }}
 */
export function parseProposalArgs(root) {
  const args = process.argv.slice(2);
  let simMonth = 5;
  let outDir = join(root, DEFAULT_PROPOSALS_DIR);
  let skipDrive = false;

  for (const arg of args) {
    if (arg.startsWith('--sim-month=')) {
      const n = Number(arg.split('=')[1]);
      if (Number.isFinite(n) && n > 0) simMonth = n;
    } else if (arg.startsWith('--out-dir=')) {
      outDir = join(root, arg.slice('--out-dir='.length));
    } else if (arg === '--skip-drive') {
      skipDrive = true;
    }
  }

  if (outDir !== join(root, DEFAULT_PROPOSALS_DIR)) skipDrive = true;

  return { simMonth, outDir, skipDrive };
}
