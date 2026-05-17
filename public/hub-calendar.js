/**
 * Highlight past, in-progress, and next regatta on the hub calendar.
 */
function initHubCalendar() {
    const list = document.getElementById('hubCalendarList');
    if (!list || list.dataset.bound === '1') return;
    list.dataset.bound = '1';

    const now = new Date();
    let nextMarked = false;

    list.querySelectorAll('.hub-calendar-item').forEach((item) => {
        const start = new Date(`${item.dataset.start}T00:00:00`);
        const end = new Date(`${item.dataset.end}T23:59:59`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return;
        }

        item.classList.remove(
            'hub-calendar-item--past',
            'hub-calendar-item--current',
            'hub-calendar-item--next',
        );

        if (now > end) {
            item.classList.add('hub-calendar-item--past');
        } else if (now >= start && now <= end) {
            item.classList.add('hub-calendar-item--current');
        } else if (!nextMarked) {
            item.classList.add('hub-calendar-item--next');
            nextMarked = true;
        }
    });
}

document.addEventListener('DOMContentLoaded', initHubCalendar);
