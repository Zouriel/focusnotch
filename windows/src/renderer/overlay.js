'use strict';

const el = {
  scrim: document.getElementById('scrim'),
  icon: document.getElementById('cardIcon'),
  title: document.getElementById('title'),
  sub: document.getElementById('sub'),
  count: document.getElementById('count'),
  barFill: document.getElementById('barFill'),
  skipBtn: document.getElementById('skipBtn'),
  dismissBtn: document.getElementById('dismissBtn'),
  againBtn: document.getElementById('againBtn'),
  dismissLabel: document.getElementById('dismissLabel'),
  card: document.getElementById('card'),
};

applyIcons();

const fmt = (secs) => {
  const s = Math.max(0, secs);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

window.notchApi.onState((s) => {
  const root = document.documentElement;
  root.style.setProperty('--scale', s.config.scale);
  root.style.setProperty('--dim', s.config.dimOpacity);
  for (const [k, v] of Object.entries(s.config.colours || {})) {
    root.style.setProperty(`--${k}`, v);
  }

  const kind = s.overlayKind; // 'break' | 'back' | 'done' | null
  const preview = s.previewing;

  el.scrim.classList.toggle('shown', s.showOverlay);
  el.scrim.classList.toggle('greeting', kind === 'back');
  el.scrim.classList.toggle('done', kind === 'done');

  if (kind === 'done') {
    setIcon(el.icon, 'timer_off');
    el.title.textContent = "Time's up";
    const mins = s.minutes;
    el.sub.textContent = `${mins} minute${mins === 1 ? '' : 's'} of focus finished.`;
  } else if (kind === 'back') {
    setIcon(el.icon, 'resume');
    el.title.textContent = 'Back to it';
    const mins = Math.round((s.plan[s.phase]?.secs ?? 0) / 60);
    el.sub.textContent = `Block ${s.block} of ${s.blocks} · ${mins} minute${mins === 1 ? '' : 's'}`;
  } else {
    setIcon(el.icon, 'local_cafe');
    el.title.textContent = 'Break time';
    el.sub.textContent = preview
      ? 'This is what a break looks like.'
      : `Block ${s.block} of ${s.blocks} done. Step away from the screen.`;
  }

  const total = s.plan[s.phase]?.secs ?? 0;
  el.count.textContent = preview ? '05:00' : fmt(s.remaining);
  el.barFill.style.width = `${preview || total <= 0 ? 100 : (s.remaining / total) * 100}%`;

  el.skipBtn.hidden = kind !== 'break' || preview;
  el.againBtn.hidden = kind !== 'done';
  el.dismissLabel.textContent = kind === 'back' ? 'Got it' : kind === 'done' ? 'Done' : 'Dismiss';
});

// Clicking the scrim dismisses; clicking the card must not.
el.scrim.addEventListener('click', () => window.notchApi.action('dismissBreak'));
el.card.addEventListener('click', (e) => e.stopPropagation());

el.skipBtn.addEventListener('click', () => window.notchApi.action('skip'));
el.againBtn.addEventListener('click', () => window.notchApi.action('restart'));
el.dismissBtn.addEventListener('click', () => window.notchApi.action('dismissBreak'));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.notchApi.action('dismissBreak');
});
