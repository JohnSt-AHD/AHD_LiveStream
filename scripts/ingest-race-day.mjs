/**
 * End-of-day ingest: match incoming camera files to race-cue windows and
 * cut Hub-named clips with ffmpeg.
 *
 * Dry-run (plan only):
 *   node scripts/ingest-race-day.mjs --incoming "D:\AHD\nzcc\2026-02-18\incoming"
 *
 * Cut files:
 *   node scripts/ingest-race-day.mjs --incoming "D:\AHD\nzcc\2026-02-18\incoming" --apply
 *
 * Layout (folder names pick the camera):
 *   incoming/vmix/          → Stream
 *   incoming/start-cam/     → Start cam  (also start, cam-a)
 *   incoming/barge/
 *   incoming/drone/
 *
 * Needs ffmpeg + ffprobe on PATH. Does not upload to Drive (OAuth is read-only).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMERA_OPTIONS, cameraLabel } from '../api/lib/rowing-hub-names.mjs';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CUES_DIR = join(ROOT, 'public', 'data', 'race-cues');
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mxf', '.mts', '.m2ts', '.avi', '.mkv', '.mpg', '.mpeg', '.ts']);
const SKIP_DIRS = new Set(['hub', 'outgoing', 'cuts', 'node_modules', '.git']);

const FOLDER_TO_CAMERA = [
    [/^vmix$|^stream$|^pgm$|^program$/i, 'stream'],
    [/^start(?:[-_ ]?cam)?$|^startcam$|^cam[-_]?a$/i, 'start-cam'],
    [/^barge$|^follow$|^mid(?:[-_ ]?course)?$/i, 'barge'],
    [/^drone$|^aerial$/i, 'drone'],
    [/^podium$|^medal$/i, 'podium'],
    [/^slow(?:[-_ ]?mo(?:tion)?)?$|^slo[-_]?mo$|^replay$/i, 'slow-motion'],
    [/^other$|^spare$/i, 'other'],
];

function parseArgs(argv) {
    const args = {
        incoming: '',
        cues: '',
        out: '',
        preroll: 30,
        tail: 60,
        apply: false,
        accurate: false,
        offset: 0,
        cameraOffset: {},
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--incoming' || a === '-i') args.incoming = next();
        else if (a === '--cues') args.cues = next();
        else if (a === '--out' || a === '-o') args.out = next();
        else if (a === '--preroll') args.preroll = Number(next());
        else if (a === '--tail') args.tail = Number(next());
        else if (a === '--offset') args.offset = Number(next());
        else if (a === '--apply') args.apply = true;
        else if (a === '--accurate') args.accurate = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else if (a.startsWith('--offset-')) {
            const id = a.slice('--offset-'.length);
            args.cameraOffset[id] = Number(next());
        }
    }
    return args;
}

function usage() {
    return `Race-day ingest — cut Hub-named clips from incoming camera files.

  node scripts/ingest-race-day.mjs --incoming <folder> [--cues <json>] [--apply]

  --incoming   Folder of camera subfolders (vmix, start-cam, barge, drone, …)
  --cues       Race-cues JSON (default: public/data/race-cues/{regatta}/{date}.json)
  --out        Output folder (default: <incoming>/../hub)
  --preroll    Seconds before Draw (default 30)
  --tail       Seconds after Results / next Draw (default 60)
  --offset     Seconds added to every file clock (SD cards running slow)
  --offset-start-cam 12   Per-camera clock offset
  --accurate   Decode to the cut point (slower, tighter than keyframe copy)
  --apply      Write files. Without this flag, only print the plan.
`;
}

function cameraFromFolder(name) {
    const n = String(name || '').trim();
    for (const [re, id] of FOLDER_TO_CAMERA) {
        if (re.test(n)) return id;
    }
    return '';
}

function cameraFromPath(filePath, incomingRoot) {
    const rel = filePath.slice(incomingRoot.length).replace(/^[\\/]/, '');
    const parts = rel.split(/[\\/]/).slice(0, -1);
    for (let i = parts.length - 1; i >= 0; i--) {
        const id = cameraFromFolder(parts[i]);
        if (id) return id;
    }
    return cameraFromFolder(basename(dirname(filePath))) || 'other';
}

function safeFilename(name) {
    return String(name || 'clip')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function overlapMs(a0, a1, b0, b1) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

async function walkVideos(dir, incomingRoot, acc = []) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
            await walkVideos(full, incomingRoot, acc);
            continue;
        }
        if (!VIDEO_EXT.has(extname(entry.name).toLowerCase())) continue;
        acc.push(full);
    }
    return acc;
}

async function probeFile(file) {
    const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        file,
    ], { windowsHide: true, maxBuffer: 8_000_000 });
    const info = JSON.parse(stdout);
    const duration = Number(info.format?.duration);
    const tags = {
        ...(info.format?.tags || {}),
        ...(info.streams || []).reduce((all, s) => ({ ...all, ...(s.tags || {}) }), {}),
    };
    const createdRaw = tags.creation_time
        || tags.CREATION_TIME
        || tags['com.apple.quicktime.creationdate']
        || tags.com_apple_quicktime_creation_date;
    let startMs = createdRaw ? Date.parse(createdRaw) : NaN;
    if (!Number.isFinite(startMs)) {
        const st = await stat(file);
        startMs = Number(st.birthtimeMs || st.mtimeMs);
    }
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`No duration for ${basename(file)}`);
    }
    if (!Number.isFinite(startMs)) {
        throw new Error(`No start time for ${basename(file)}`);
    }
    return { file, duration, startMs };
}

function loadCuePath(args, incoming) {
    if (args.cues) return resolve(args.cues);
    const bits = incoming.replace(/[\\/]+/g, '/').split('/');
    const date = bits.find((b) => /^\d{4}-\d{2}-\d{2}$/.test(b));
    const incomingIdx = bits.findIndex((b) => b.toLowerCase() === 'incoming');
    const maybeRegatta = incomingIdx > 0 ? bits[incomingIdx - 2] || bits[incomingIdx - 1] : '';
    const regatta = String(maybeRegatta || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (regatta && date) return join(CUES_DIR, regatta, `${date}.json`);
    return '';
}

function raceWindows(day, prerollSec, tailSec) {
    const preroll = prerollSec * 1000;
    const tail = tailSec * 1000;
    return (day.races || []).map((race) => {
        const draw = Date.parse(race.drawAt);
        const end = Date.parse(race.endAt);
        if (!Number.isFinite(draw)) {
            return { race, skip: 'no-draw' };
        }
        if (!Number.isFinite(end) || end <= draw) {
            return { race, skip: 'still-open' };
        }
        return {
            race,
            draw,
            end,
            winStart: draw - preroll,
            winEnd: end + tail,
        };
    });
}

function hubFileForCamera(race, camera) {
    const hit = (race.hub?.files || []).find((f) => f.camera === camera);
    if (hit?.filename) return hit.filename;
    const title = race.hub?.title || `Race ${race.raceNum || race.race}`;
    return camera === 'stream' ? title : `${title} ${cameraLabel(camera)}`;
}

function planCuts({ windows, files, day, args }) {
    const cameras = [...new Set(files.map((f) => f.camera))];
    const jobs = [];
    const warnings = [];
    for (const win of windows) {
        if (win.skip) {
            warnings.push(`Race ${win.race.race || win.race.raceNum}: skipped (${win.skip})`);
            continue;
        }
        const wanted = (win.race.hub?.files || []).map((f) => f.camera);
        const cams = wanted.length ? wanted : cameras;
        for (const camera of cams) {
            const candidates = files.filter((f) => f.camera === camera);
            let best = null;
            for (const file of candidates) {
                const fileEnd = file.startMs + file.duration * 1000;
                const overlap = overlapMs(win.winStart, win.winEnd, file.startMs, fileEnd);
                if (overlap <= 0) continue;
                if (!best || overlap > best.overlap) best = { file, overlap, fileEnd };
            }
            if (!best) {
                warnings.push(`Race ${win.race.race || win.race.raceNum}: no ${cameraLabel(camera)} file overlaps`);
                continue;
            }
            const cutStartMs = Math.max(0, win.winStart - best.file.startMs);
            const cutEndMs = Math.min(best.file.duration * 1000, win.winEnd - best.file.startMs);
            const durationSec = (cutEndMs - cutStartMs) / 1000;
            const coverage = best.overlap / (win.winEnd - win.winStart);
            if (coverage < 0.5) {
                warnings.push(
                    `Race ${win.race.race || win.race.raceNum} ${cameraLabel(camera)}: only ${Math.round(coverage * 100)}% coverage`,
                );
            }
            const ext = extname(best.file.file) || '.mp4';
            const filename = `${safeFilename(hubFileForCamera(win.race, camera))}${ext}`;
            jobs.push({
                race: win.race.race || String(win.race.raceNum),
                raceNum: win.race.raceNum,
                camera,
                source: best.file.file,
                ss: Number((cutStartMs / 1000).toFixed(3)),
                duration: Number(durationSec.toFixed(3)),
                filename,
                description: camera === 'stream' ? (win.race.hub?.description || '') : '',
                coverage: Number(coverage.toFixed(3)),
            });
        }
    }
    return { jobs, warnings, cameras, day };
}

async function cutJob(job, outDir, accurate) {
    const dest = join(outDir, job.filename);
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (!accurate) args.push('-ss', String(job.ss));
    args.push('-i', job.source);
    if (accurate) args.push('-ss', String(job.ss));
    args.push('-t', String(job.duration), '-c', 'copy', '-map', '0', '-avoid_negative_ts', 'make_zero', dest);
    await execFileAsync('ffmpeg', args, { windowsHide: true });
    if (job.description) {
        await writeFile(`${dest}.txt`, `${job.description}\n`, 'utf8');
    }
    return dest;
}

async function hasBin(name) {
    try {
        await execFileAsync(name, ['-version'], { windowsHide: true });
        return true;
    } catch {
        return false;
    }
}

function printPlan(plan, outDir, apply) {
    console.log(`\n  ${apply ? 'Cutting' : 'Plan'} ${plan.jobs.length} clip${plan.jobs.length === 1 ? '' : 's'} → ${outDir}\n`);
    for (const job of plan.jobs) {
        const cam = cameraLabel(job.camera);
        console.log(`  Race ${job.race} · ${cam}`);
        console.log(`    ${basename(job.source)}  +${job.ss}s  ${job.duration}s  (${Math.round(job.coverage * 100)}%)`);
        console.log(`    ${job.filename}`);
    }
    if (plan.warnings.length) {
        console.log('\n  Warnings:');
        for (const w of plan.warnings) console.log(`    - ${w}`);
    }
    if (!apply) console.log('\n  Dry-run. Add --apply to write the Hub-named cuts.\n');
    else console.log('');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.incoming) {
        process.stdout.write(usage());
        process.exit(args.help || args.incoming ? 0 : 1);
    }
    if (!Number.isFinite(args.preroll) || !Number.isFinite(args.tail)) {
        throw new Error('preroll and tail must be numbers');
    }

    const incoming = resolve(args.incoming);
    const incomingStat = await stat(incoming).catch(() => null);
    if (!incomingStat?.isDirectory()) {
        throw new Error(`Incoming folder not found: ${incoming}`);
    }

    const cuePath = loadCuePath(args, incoming);
    if (!cuePath) {
        throw new Error('Could not infer race-cues JSON. Pass --cues path\\to\\yyyy-mm-dd.json');
    }
    let day;
    try {
        day = JSON.parse(await readFile(cuePath, 'utf8'));
    } catch {
        throw new Error(`Could not read cues: ${cuePath}`);
    }
    if (!Array.isArray(day.races) || !day.races.length) {
        throw new Error(`No races in ${cuePath}. Press Record on the hub, then Draw/Results during the day.`);
    }

    if (!(await hasBin('ffprobe')) || !(await hasBin('ffmpeg'))) {
        throw new Error('ffmpeg and ffprobe must be on PATH');
    }

    const paths = await walkVideos(incoming, incoming);
    if (!paths.length) {
        throw new Error(`No video files under ${incoming}`);
    }

    const files = [];
    for (const file of paths) {
        const probed = await probeFile(file);
        const camera = cameraFromPath(file, incoming);
        const extra = Number(args.cameraOffset[camera] || 0) + Number(args.offset || 0);
        probed.startMs += extra * 1000;
        probed.camera = camera;
        files.push(probed);
        console.log(`  ${cameraLabel(camera).padEnd(12)} ${basename(file)}  ${new Date(probed.startMs).toISOString()}  ${probed.duration.toFixed(1)}s`);
    }

    const windows = raceWindows(day, args.preroll, args.tail);
    const plan = planCuts({ windows, files, day, args });
    const outDir = resolve(args.out || join(incoming, '..', 'hub'));
    printPlan(plan, outDir, args.apply);

    const index = {
        generatedAt: new Date().toISOString(),
        cues: cuePath,
        incoming,
        out: outDir,
        preroll: args.preroll,
        tail: args.tail,
        apply: args.apply,
        cameras: CAMERA_OPTIONS.filter((c) => plan.cameras.includes(c.id)).map((c) => c.id),
        warnings: plan.warnings,
        jobs: plan.jobs,
    };

    if (!args.apply) {
        return;
    }
    if (!plan.jobs.length) {
        throw new Error('Nothing to cut.');
    }

    await mkdir(outDir, { recursive: true });
    for (const job of plan.jobs) {
        process.stdout.write(`  writing ${job.filename} … `);
        await cutJob(job, outDir, args.accurate);
        console.log('ok');
    }
    await writeFile(join(outDir, `${day.date || 'index'}.json`), `${JSON.stringify({ ...index, jobs: plan.jobs }, null, 2)}\n`, 'utf8');
    try {
        await writeFile(join(outDir, basename(cuePath)), await readFile(cuePath));
    } catch {
        /* cues already copied beside incoming */
    }
    console.log(`\n  Done. Copy ${outDir} to the AHD Drive date folder when the link is quiet.\n`);
}

main().catch((err) => {
    console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
});
