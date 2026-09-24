/**
 * Cold-start branded intro — continues native teal splash into the web UI.
 * Once per session (sessionStorage). CSS starts logo/title; JS times the fade-out.
 * Total ~1.5s (≈0.28s when prefers-reduced-motion).
 */
const STORAGE_KEY = 'rnzIntroSeen_v1';
const TOTAL_MS = 1500;
const REDUCED_MS = 280;

export function runIntro() {
  const root = document.getElementById('rnzIntro');
  if (!root) return;

  if (sessionStorage.getItem(STORAGE_KEY) || document.documentElement.classList.contains('rnz-intro-skip')) {
    root.remove();
    return;
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }

  document.documentElement.classList.add('rnz-intro-playing');

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) root.classList.add('rnz-intro--reduced');

  const duration = reduce ? REDUCED_MS : TOTAL_MS;

  const finish = () => {
    root.classList.add('rnz-intro--out');
    document.documentElement.classList.remove('rnz-intro-playing');
    document.documentElement.classList.add('rnz-intro-done');
    const remove = () => {
      root.remove();
    };
    root.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, 400);
  };

  window.setTimeout(finish, duration);
}
