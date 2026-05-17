/**
 * Hub footer — fleet map GPS refresh interval control.
 */
document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('hubMapRefreshSelect');
    const note = document.getElementById('hubMapRefreshNote');
    const core = window.AltitudeHdMapRefresh;
    if (!select || !core) return;

    for (const preset of core.getPresets()) {
        const opt = document.createElement('option');
        opt.value = String(preset.ms);
        opt.textContent = preset.label;
        select.appendChild(opt);
    }

    function syncSelect() {
        const ms = core.getIntervalMs();
        select.value = String(ms);
        if (note) {
            note.textContent = `Fleet maps and the stats bar refresh ${core.formatShort(ms)} in this browser.`;
        }
    }

    select.addEventListener('change', () => {
        core.setIntervalMs(Number(select.value));
        syncSelect();
    });

    window.addEventListener('altitudehd:map-refresh-rate', syncSelect);
    syncSelect();
});
