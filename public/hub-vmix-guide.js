/**
 * Hub — live vMix URL examples from regatta code.
 */
const VMIX_PAGES = {
    kri: 'vmix-kri.html',
    'rnz-milford': 'vmix-rnz-milford.html',
    'beachsprints-milford': 'vmix-beachsprints-milford.html',
};

const VMIX_TRIGGERS = [
    { key: 't', graphic: 'Title', desc: 'KRI — title graphic' },
    { key: 'l', graphic: 'Lower third', desc: 'Milford: video in, text at 1s, pause at 1.5s; o fades text and finishes video' },
    { key: 'd', graphic: 'Draw', desc: 'Milford: continuous video; text at 5s, fades out at 25s; n/p steps race number ±1; o fades text early' },
    { key: 'r', graphic: 'Results', desc: 'Milford: text at 6s, auto text out at 16s, video plays through' },
    { key: 'w', graphic: 'Leader', desc: 'KRI — leader box top-right (Milford placement, white panel + blue accents); fade in/out with o · 1–8 switch lane · Milford — leader video + lane text' },
    { key: 'x', graphic: 'CV leader', desc: 'KRI only — single leader box follows live CV position; crew from lane 1–8 (same as w) · o to fade out' },
    { key: 'h', graphic: 'CV draw', desc: 'KRI only — one line + crew card per CV boat slot (daysheet draw); race leader gets gold glow · boat count from CV Analysis · o to fade out' },
    { key: 'u', graphic: 'Course underlay', desc: 'KRI only — procedural Karāpiro 2 km course (10 lanes × 10 m, OOB, buoys, 250 m marks); sim 4 m/s · lane draw from live race · 1–9 / 0 assign Leader highlight on a lane · ?deviceId= CrewSight · o to fade out' },
    { key: 's', graphic: 'Schedule', desc: 'KRI only — upcoming 10 races from hub live race (CSS gradient panel); fade in/out with o' },
    { key: 'o', graphic: 'Out', desc: 'Fade text and resume video to end (KRI: fade overlay out)' },
    { key: 'g', graphic: 'Tracker', desc: 'Milford only — tracker video; route dots at 1s, speed + pause at 3s (fleet map setup); o finishes video' },
    { key: 'v', graphic: 'Speed chart', desc: 'KRI only — lower-third speed vs distance replay in real time (~7 min demo); ease in/out; add &loop=1 to repeat' },
    { key: 'k', graphic: 'Live tracking', desc: 'KRI only — bottom-right crew positions from demo data (rank, logo, club code, gap); leader distance to go; o to fade out' },
    { key: 'm', graphic: 'Weather map', desc: 'KRI only — full-screen Lake Karāpiro live weather (wind, temp, rain, 3 hr forecast); o to fade out' },
    { key: 'c', graphic: 'Clear', desc: 'Instant clear — idle, ready for any graphic' },
    { key: 'n', graphic: 'Next race', desc: 'Live race number +1 on daysheet (updates draw/LT/results on air)' },
    { key: 'p', graphic: 'Previous race', desc: 'Live race number −1 on daysheet (updates draw/LT/results on air)' },
];

const VMIX_LS_TRIGGER = 'altitudeHdVmixTrigger_v1';

function hubSendVmixTrigger(action, graphic) {
    const payload = { action, graphic: graphic || null, t: Date.now() };
    try {
        localStorage.setItem(VMIX_LS_TRIGGER, JSON.stringify(payload));
    } catch {
        /* ignore */
    }
    document.dispatchEvent(
        new CustomEvent('altitudehd:vmixtrigger', { detail: payload }),
    );
}

function hubVmixBaseUrl(page) {
    const path = location.pathname.replace(/[^/]*$/, '');
    return `${location.origin}${path}${page}`;
}

function hubGetLiveRace() {
    return (
        window.AltitudeHdLiveRace?.getLiveRace?.() ||
        document.getElementById('hubLiveRaceInput')?.value ||
        '12'
    );
}

function hubVmixUrl(page, graphic, race) {
    const code =
        window.AltitudeHdHub?.getRegattaCode?.() ||
        document.getElementById('hubRegattaCode')?.value ||
        'mads2026';
    const u = new URL(hubVmixBaseUrl(page));
    u.searchParams.set('g', graphic);
    u.searchParams.set('race', race || hubGetLiveRace());
    u.searchParams.set('regatta', code);
    return u.href;
}

function hubRenderVmixGuide() {
    const table = document.getElementById('hubVmixTriggerTable');
    const examples = document.getElementById('hubVmixExamples');
    if (!table && !examples) return;

    if (table) {
        const tbody = table.querySelector('tbody');
        if (tbody) {
            tbody.replaceChildren();
            for (const t of VMIX_TRIGGERS) {
                const tr = document.createElement('tr');
                const code =
                    t.key === 'o' || t.key === 'c' || t.key === 'g'
                        ? `<code>${t.key}</code>`
                        : `<code>${t.key}</code> / <code>g=${t.key}</code>`;
                tr.innerHTML = `<td>${code}</td><td>${t.graphic}</td><td>${t.desc}</td>`;
                tbody.appendChild(tr);
            }
        }
    }

    if (examples) {
        examples.replaceChildren();
        const race = hubGetLiveRace();
        for (const [theme, page] of Object.entries(VMIX_PAGES)) {
            const block = document.createElement('div');
            block.className = 'hub-vmix-theme-block';
            const title = document.createElement('h3');
            title.className = 'hub-vmix-theme-title';
            title.textContent = theme.replace(/-/g, ' ');
            block.appendChild(title);
            const ul = document.createElement('ul');
            ul.className = 'hub-vmix-url-list';
            for (const t of VMIX_TRIGGERS) {
                if (t.key === 'o') continue;
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = `${hubVmixUrl(page, t.key, race)}&autoplay=1`;
                a.target = '_blank';
                a.rel = 'noopener';
                a.textContent = `${t.graphic} (preview)`;
                li.appendChild(a);
                ul.appendChild(li);
            }
            block.appendChild(ul);
            examples.appendChild(block);
        }

        const weatherNote = document.createElement('p');
        weatherNote.className = 'hub-vmix-map-note';
        weatherNote.innerHTML =
            '<strong>KRI weather map (<code>m</code>):</strong> on <a href="' +
            hubVmixBaseUrl('vmix-kri.html') +
            '" target="_blank" rel="noopener">vmix-kri.html</a> or standalone <a href="' +
            hubVmixBaseUrl('vmix-kri-weather.html') +
            '" target="_blank" rel="noopener">vmix-kri-weather.html</a> · Open-Meteo live data, wind arrows, temperature, rainfall, 3 hr forecast (10 min refresh). ~90% transparent for overlay on vision.';
        examples.appendChild(weatherNote);

        const mapNote = document.createElement('p');
        mapNote.className = 'hub-vmix-map-note';
        mapNote.innerHTML =
            '<strong>Tracker (<code>g</code>):</strong> Milford tracker WebM — route dots at 1s, live speed + pause at 3s using the same overlay as the <a href="live-map.html">fleet map</a> speed screen (device + start/finish pins). <code>o</code> clears overlay and finishes video.';
        examples.appendChild(mapNote);

        const leaderNote = document.createElement('p');
        leaderNote.className = 'hub-vmix-map-note';
        leaderNote.innerHTML =
            '<strong>Leader (<code>w</code>):</strong> KRI — white panel top-right (same text placement as Milford GT); fade in with <code>w</code>, out with <code>o</code>. Set <strong>Leader lane</strong> on the hub (default 4); press <code>1</code>–<code>8</code> on air to switch lane. Milford — leader video pauses at 6s; text fades in after 2s.';
        examples.appendChild(leaderNote);

        const cvLeaderNote = document.createElement('p');
        cvLeaderNote.className = 'hub-vmix-map-note';
        const kriCvUrl = new URL(hubVmixBaseUrl('vmix-kri.html'));
        kriCvUrl.searchParams.set('streamId', 'YOUR_GPS_STREAM_ID');
        kriCvUrl.searchParams.set('g', 'x');
        cvLeaderNote.innerHTML =
            '<strong>CV leader (<code>x</code>):</strong> KRI only — same leader card as <code>w</code>, but positioned from live CV via a tapered 45° line (box sits up-right of the leader). On the CV laptop, stream ID loads from setup config automatically; on vMix add <code>?streamId=</code> to the browser URL. Example: <a href="' +
            kriCvUrl.href +
            '" target="_blank" rel="noopener">vmix-kri.html?streamId=…&amp;g=x</a> · <code>1</code>–<code>8</code> switch lane on air.';
        examples.appendChild(cvLeaderNote);

        const cvNote = document.createElement('p');
        cvNote.className = 'hub-vmix-map-note';
        const cvUrl = new URL(hubVmixBaseUrl('vmix-cv-leader.html'));
        cvUrl.searchParams.set('streamId', 'YOUR_GPS_STREAM_ID');
        const cvMonitorUrl = new URL(hubVmixBaseUrl('cv-position-monitor.html'));
        cvMonitorUrl.searchParams.set('streamId', 'YOUR_GPS_STREAM_ID');
        cvNote.innerHTML =
            '<strong>CV leader line:</strong> laptop YOLO → <code>/api/cv-position</code> → transparent overlay. vMix browser: <a href="' +
            cvUrl.href +
            '" target="_blank" rel="noopener">vmix-cv-leader.html</a> · monitor: <a href="' +
            cvMonitorUrl.href +
            '" target="_blank" rel="noopener">cv-position-monitor.html</a> · same <code>streamId</code> as GPS. Run <code>karapiro.py</code> / <code>twizel.py</code> with <code>CV_STREAM_ID</code> set.';
        examples.appendChild(cvNote);

        const devNote = document.createElement('p');
        devNote.className = 'hub-vmix-map-note';
        const devLinks = Object.entries(VMIX_PAGES)
            .map(([theme, page]) => {
                const u = new URL(hubVmixBaseUrl(page));
                u.searchParams.set('dev', '1');
                u.searchParams.set('g', 'd');
                u.searchParams.set('regatta', document.getElementById('hubRegattaCode')?.value || 'mads2026');
                u.searchParams.set('race', race);
                return `<a href="${u.href}" target="_blank" rel="noopener">${theme} layout editor</a>`;
            })
            .join(' · ');
        devNote.innerHTML = `<strong>Layout dev mode:</strong> drag text and logos into place, then save (${devLinks}). Uses this browser’s local storage — vMix on the same PC picks up saved positions.`;
        examples.appendChild(devNote);
    }
}

function hubUpdateVmixLinkCards() {
    const race = hubGetLiveRace();
    document.querySelectorAll('.hub-link-card--vmix').forEach((card) => {
        const graphic = card.dataset.vmixGraphic || 'l';
        const page = card.dataset.vmixPage;
        if (page) card.href = hubVmixUrl(page, graphic, race);
    });
}

function hubBindVmixTriggerButtons() {
    const row = document.getElementById('hubVmixTriggerButtons');
    if (!row || row.dataset.bound === '1') return;
    row.dataset.bound = '1';

    row.querySelectorAll('[data-vmix-trigger]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.vmixTrigger;
            const graphic = btn.dataset.vmixGraphic || null;
            if (action === 'out') hubSendVmixTrigger('out');
            else if (action === 'clear') hubSendVmixTrigger('clear');
            else if (graphic) hubSendVmixTrigger('in', graphic);
        });
    });
}

function initHubVmixGuide() {
    hubRenderVmixGuide();
    hubUpdateVmixLinkCards();
    hubBindVmixTriggerButtons();
    document.addEventListener('altitudehd:urls', hubRenderVmixGuide);
    document.addEventListener('altitudehd:liverace', () => {
        hubRenderVmixGuide();
        hubUpdateVmixLinkCards();
    });
    const codeInput = document.getElementById('hubRegattaCode');
    if (codeInput) {
        codeInput.addEventListener('input', hubRenderVmixGuide);
        codeInput.addEventListener('change', hubRenderVmixGuide);
    }
}

window.hubSendVmixTrigger = hubSendVmixTrigger;

document.addEventListener('DOMContentLoaded', initHubVmixGuide);
