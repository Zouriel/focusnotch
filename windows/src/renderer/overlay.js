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

  const greeting = s.backToWork;
  el.scrim.classList.toggle('greeting', greeting);
  el.scrim.classList.toggle('shown', s.showBreakScreen);

  setIcon(el.icon, greeting ? 'resume' : 'local_cafe');
  el.title.textContent = greeting ? 'Back to it' : 'Break time';

  if (greeting) {
    const mins = Math.round((s.plan[s.phase]?.secs ?? 0) / 60);
    el.sub.textContent = `Block ${s.block} of ${s.blocks} · ${mins} minute${mins === 1 ? '' : 's'}`;
  } else if (s.previewing) {
    el.sub.textContent = 'This is what a break looks like.';
  } else {
    el.sub.textContent = `Block ${s.block} of ${s.blocks} done. Step away from the screen.`;
  }

  const total = s.plan[s.phase]?.secs ?? 0;
  el.count.textContent = s.previewing ? '05:00' : fmt(s.remaining);
  el.barFill.style.width = `${s.previewing || total <= 0 ? 100 : (s.remaining / total) * 100}%`;

  el.skipBtn.hidden = greeting || s.previewing;
  el.dismissLabel.textContent = greeting ? 'Got it' : 'Dismiss';
});

// Clicking the scrim dismisses; clicking the card must not.
el.scrim.addEventListener('click', () => window.notchApi.action('dismissBreak'));
el.card.addEventListener('click', (e) => e.stopPropagation());

el.skipBtn.addEventListener('click', () => window.notchApi.action('skip'));
el.dismissBtn.addEventListener('click', () => window.notchApi.action('dismissBreak'));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.notchApi.action('dismissBreak');
});
