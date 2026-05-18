#!/usr/bin/env node
/**
 * CLI: extract positions/timing from vMix GT Designer .gtxml / .gtzip / .gt
 *
 * Usage:
 *   node scripts/gt-to-layout.mjs path/to/template.gtxml
 *   node scripts/gt-to-layout.mjs path/to/template.gtzip --graphic draw --theme kri
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readGtXml(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.gtxml' || ext === '.gt') {
        return fs.readFileSync(filePath, 'utf8');
    }
    if (ext === '.gtzip') {
        const tmp = path.join(os.tmpdir(), `gt-parse-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const dest = path.join(tmp, 'extracted');
        fs.mkdirSync(dest, { recursive: true });
        execSync(
            `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${filePath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force"`,
            { stdio: 'pipe' },
        );
        const docPath = path.join(dest, 'document.xml');
        if (!fs.existsSync(docPath)) {
            const found = fs
                .readdirSync(dest, { recursive: true })
                .find((f) => String(f).endsWith('document.xml'));
            if (!found) throw new Error('No document.xml in GTZIP');
            return fs.readFileSync(path.join(dest, found), 'utf8');
        }
        return fs.readFileSync(docPath, 'utf8');
    }
    throw new Error('Expected .gtxml, .gt, or .gtzip');
}

/** Minimal XML parse — mirrors public/vmix-gt-import.js logic */
function parseMargin(margin) {
    if (!margin) return null;
    const p = margin.split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 2 || Number.isNaN(p[0]) || Number.isNaN(p[1])) return null;
    return { left: p[0], top: p[1] };
}

function parseGtXml(xml) {
    const elements = [];
    const re = /<(\w+)([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let m;
    while ((m = re.exec(xml))) {
        const tag = m[1];
        if (!['TextBlock', 'Rectangle', 'Image', 'Grid', 'Border'].includes(tag)) continue;
        const attrs = m[2];
        const nameM = attrs.match(/(?:x:)?Name="([^"]+)"/);
        const marginM = attrs.match(/Margin="([^"]+)"/);
        const wM = attrs.match(/Width="([^"]+)"/);
        const hM = attrs.match(/Height="([^"]+)"/);
        const fgM = attrs.match(/Foreground="([^"]+)"/);
        const margin = marginM ? parseMargin(marginM[1]) : null;
        const props = {};
        if (margin) {
            props.left = `${margin.left}px`;
            props.top = `${margin.top}px`;
        }
        if (wM) props.width = wM[1].endsWith('px') ? wM[1] : `${wM[1]}px`;
        if (hM) props.height = hM[1].endsWith('px') ? hM[1] : `${hM[1]}px`;
        if (fgM && /^#|^rgb/i.test(fgM[1])) props.color = fgM[1];
        if (!nameM && !props.left) continue;
        elements.push({ name: nameM?.[1] || tag, tag, props });
    }
    return { elements };
}

const file = process.argv[2];
if (!file) {
    console.error('Usage: node scripts/gt-to-layout.mjs <file.gtxml|gtzip|gt>');
    process.exit(1);
}

const xml = readGtXml(path.resolve(file));
const parsed = parseGtXml(xml);
console.log(JSON.stringify(parsed, null, 2));
