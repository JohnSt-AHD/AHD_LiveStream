/**
 * Regenerate public/data/missing-school-logos.json from ahd-lookup vs assets/school-logos.
 * Usage: node scripts/report-missing-school-logos.js
 */
const fs = require('fs');
const path = require('path');

const lookupPath = path.join('public', 'data', 'ahd-lookup.json');
const logoDir = path.join('public', 'assets', 'school-logos');
const outPath = path.join('public', 'data', 'missing-school-logos.json');

const lookup = JSON.parse(fs.readFileSync(lookupPath, 'utf8'));
const files = new Set(fs.readdirSync(logoDir));
const missingFile = [];
const noLogo = [];

for (const [id, c] of Object.entries(lookup.clubs || {})) {
    const logo = String(c.logo || '').trim();
    if (!logo) {
        noLogo.push({ id, name: c.name });
        continue;
    }
    if (!files.has(logo)) {
        missingFile.push({ id, name: c.name, logo });
    }
}

const out = {
    generatedAt: new Date().toISOString(),
    logoFilesOnDisk: files.size,
    clubsInLookup: Object.keys(lookup.clubs || {}).length,
    missingFileCount: missingFile.length,
    noLogoFieldCount: noLogo.length,
    missingFile: missingFile.sort((a, b) => a.name.localeCompare(b.name)),
    noLogo: noLogo.sort((a, b) => a.name.localeCompare(b.name)),
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
    `Wrote ${outPath}: ${missingFile.length} missing files, ${noLogo.length} without logo field`,
);
