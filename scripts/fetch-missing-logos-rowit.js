/**
 * Download missing school/club logos from RowIT (https://rowit.nz/organisations).
 * Source images: https://s.rowit.nz/i/o/{clubId}.png
 *
 * Usage: node scripts/fetch-missing-logos-rowit.js
 *        node scripts/fetch-missing-logos-rowit.js --dry-run
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const MISSING_PATH = path.join(ROOT, 'public', 'data', 'missing-school-logos.json');
const LOGO_DIR = path.join(ROOT, 'public', 'assets', 'school-logos');
const ROWIT_LOGO = (id) => `https://s.rowit.nz/i/o/${encodeURIComponent(id.toLowerCase())}.png`;

const dryRun = process.argv.includes('--dry-run');
const delayMs = 80;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                headers: { 'User-Agent': 'AltitudeHD-traccar-overlay/1.0 (logo sync)' },
                timeout: 20000,
            },
            (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const loc = res.headers.location;
                    res.resume();
                    if (loc) return resolve(fetchBuffer(loc.startsWith('http') ? loc : `https://s.rowit.nz${loc}`));
                    return reject(new Error(`Redirect without location (${res.statusCode})`));
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            },
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
    });
}

function isPng(buf) {
    return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

async function main() {
    const report = JSON.parse(fs.readFileSync(MISSING_PATH, 'utf8'));
    const targets = [...(report.missingFile || [])];
    console.log(`Missing logo files to try: ${targets.length} (dry-run=${dryRun})`);

    const results = { downloaded: [], notOnRowit: [], errors: [] };

    for (let i = 0; i < targets.length; i++) {
        const { id, name, logo } = targets[i];
        const dest = path.join(LOGO_DIR, logo);
        const url = ROWIT_LOGO(id);

        if (fs.existsSync(dest)) {
            results.downloaded.push({ id, name, logo, note: 'already exists' });
            continue;
        }

        try {
            if (!dryRun) {
                const buf = await fetchBuffer(url);
                if (!isPng(buf) || buf.length < 50) {
                    results.notOnRowit.push({ id, name, logo, url, reason: 'invalid or tiny response' });
                } else {
                    fs.writeFileSync(dest, buf);
                    results.downloaded.push({ id, name, logo, bytes: buf.length, url });
                }
                await sleep(delayMs);
            } else {
                results.downloaded.push({ id, name, logo, url, dryRun: true });
            }
        } catch (err) {
            const msg = err.message || String(err);
            if (/HTTP 404|HTTP 403|HTTP 410/.test(msg)) {
                results.notOnRowit.push({ id, name, logo, url, reason: msg });
            } else {
                results.errors.push({ id, name, logo, url, error: msg });
            }
        }

        if ((i + 1) % 25 === 0) {
            console.log(`  … ${i + 1}/${targets.length}`);
        }
    }

    const outPath = path.join(ROOT, 'public', 'data', 'rowit-logo-fetch-report.json');
    const summary = {
        fetchedAt: new Date().toISOString(),
        source: 'https://s.rowit.nz/i/o/{id}.png',
        dryRun,
        attempted: targets.length,
        downloadedCount: results.downloaded.filter((r) => !r.note && !r.dryRun).length,
        alreadyExisted: results.downloaded.filter((r) => r.note === 'already exists').length,
        notOnRowitCount: results.notOnRowit.length,
        errorCount: results.errors.length,
        ...results,
    };
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\nDone. Downloaded: ${summary.downloadedCount}, not on RowIT: ${summary.notOnRowitCount}, errors: ${summary.errorCount}`);
    console.log(`Report: ${outPath}`);

    if (!dryRun && summary.downloadedCount > 0) {
        console.log('Regenerating missing-school-logos.json…');
        require('./report-missing-school-logos.js');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
