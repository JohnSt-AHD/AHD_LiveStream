/**
 * Hub — live vMix URL examples from regatta code.
 */
const VMIX_PAGES = {
    kri: 'vmix-kri.html',
    'rnz-milford': 'vmix-rnz-milford.html',
    'beachsprints-milford': 'vmix-beachsprints-milford.html',
};

const VMIX_TRIGGERS = [
    { key: 't', graphic: 'Title', desc: 'Regatta code and day date' },
    { key: 'l', graphic: 'Lower third', desc: 'Race number, time, full event name, round, progression' },
    { key: 'd', graphic: 'Draw', desc: 'Lane draw — club logos, crew names, race title' },
    { key: 'r', graphic: 'Results', desc: 'Finish order with times (from results CSV)' },
];

function hubVmixBaseUrl(page) {
    const path = location.pathname.replace(/[^/]*$/, '');
    return `${location.origin}${path}${page}`;
}

function hubVmixUrl(page, graphic, race) {
    const code =
        window.AltitudeHdHub?.getRegattaCode?.() ||
        document.getElementById('hubRegattaCode')?.value ||
        'mads2026';
    const u = new URL(hubVmixBaseUrl(page));
    u.searchParams.set('g', graphic);
    u.searchParams.set('race', race || '12');
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
                tr.innerHTML = `<td><code>g=${t.key}</code></td><td>${t.graphic}</td><td>${t.desc}</td>`;
                tbody.appendChild(tr);
            }
        }
    }

    if (examples) {
        examples.replaceChildren();
        const race = '12';
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
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = hubVmixUrl(page, t.key, race);
                a.target = '_blank';
                a.rel = 'noopener';
                a.textContent = `${t.graphic} (?g=${t.key}&race=${race})`;
                li.appendChild(a);
                ul.appendChild(li);
            }
            block.appendChild(ul);
            examples.appendChild(block);
        }

        const mapNote = document.createElement('p');
        mapNote.className = 'hub-vmix-map-note';
        mapNote.innerHTML =
            '<strong>Milford fleet map (Traccar):</strong> use <a href="live-map.html">live-map.html</a> in a separate vMix input — not the <code>g=</code> trigger (reserved for title).';
        examples.appendChild(mapNote);
    }
}

function initHubVmixGuide() {
    hubRenderVmixGuide();
    document.addEventListener('altitudehd:urls', hubRenderVmixGuide);
    const codeInput = document.getElementById('hubRegattaCode');
    if (codeInput) {
        codeInput.addEventListener('input', hubRenderVmixGuide);
        codeInput.addEventListener('change', hubRenderVmixGuide);
    }
}

document.addEventListener('DOMContentLoaded', initHubVmixGuide);
