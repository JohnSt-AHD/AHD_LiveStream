/**
 * Hub — live vMix URL examples from regatta code.
 */
const VMIX_PAGES = {
    kri: 'vmix-kri.html',
    'rnz-milford': 'vmix-rnz-milford.html',
    'beachsprints-milford': 'vmix-beachsprints-milford.html',
};

const VMIX_TRIGGERS = [
    { key: 't', graphic: 'Title', desc: 'Play in — background 3s, then regatta code and date' },
    { key: 'l', graphic: 'Lower third', desc: 'Play in — background 3s, then race info text' },
    { key: 'd', graphic: 'Draw', desc: 'Play in — background 3s, then lane draw text' },
    { key: 'r', graphic: 'Results', desc: 'Play in — background 3s, then results text' },
    { key: 'o', graphic: 'Out', desc: 'Hide text, reverse background, reset to idle' },
    { key: 'g', graphic: 'Fleet map', desc: 'Milford only — Traccar live map (3s in, o out)' },
    { key: 'c', graphic: 'Clear', desc: 'Instant clear — idle, ready for any graphic' },
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

        const mapNote = document.createElement('p');
        mapNote.className = 'hub-vmix-map-note';
        mapNote.innerHTML =
            '<strong>Fleet map:</strong> press <code>g</code> on <a href="vmix-rnz-milford.html">vmix-rnz-milford.html</a> (same overlay as graphics).';
        examples.appendChild(mapNote);
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
