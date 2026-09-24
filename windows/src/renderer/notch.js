'use strict';

/**
 * The notch view.
 *
 * The window itself is a fixed transparent sheet that is click-through by
 * default; this tells main when the pointer is actually over the notch so
 * clicks land, and reports the notch's footprint so main knows where the
 * top-edge gesture applies.
 */

const el = {
  notch: document.getElementById('notch'),
  clock: document.getElementById('clock'),
  countdown: document.getElementById('countdown'),
  phaseIcon: document.getElementById('phaseIcon'),
  blocks: document.getElementById('blocks'),
  date: document.getElementById('date'),
  chips: document.getElementById('chips'),
  plan: document.getElementById('plan'),
  progress: document.getElementById('progress'),
  startBtn: document.getElementById('startBtn'),
  startIcon: document.getElementById('startIcon'),
  startLabel: document.getElementById('startLabel'),
  resetBtn: document.getElementById('resetBtn'),
  skipBtn: document.getElementById('skipBtn'),
  musicBtn: document.getElementById('musicBtn'),
  musicBox: document.getElementById('musicBox'),
  musicLabel: document.getElementById('musicLabel'),
  editBtn: document.getElementById('editBtn'),
};

let state = null;
let expanded = false;
let chipsFor = null;

const fmt = (secs) => {
  const s = Math.max(0, secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
};

// ---- pointer plumbing ------------------------------------------------------

el.notch.addEventListener('mouseenter', () => {
  expanded = true;
  el.notch.classList.add('expanded');
  window.notchApi.setInteractive(true);
});

el.notch.addEventListener('mouseleave', () => {
  expanded = false;
  el.notch.classList.remove('expanded');
  window.notchApi.setInteractive(false);
});

// The window is click-through, so hover only arrives while main has switched
// input on. Poll the notch's box instead of trusting a single enter event.
function reportRect() {
  const r = el.notch.getBoundingClientRect();
  window.notchApi.reportRect({
    x: Math.round(window.screenX + r.left),
    y: Math.round(window.screenY + r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  });
}

// mousemove reaches us even while click-through (forward: true), which is what
// lets the notch expand without the window stealing clicks first.
document.addEventListener('mousemove', (e) => {
  const r = el.notch.getBoundingClientRect();
  const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (over !== expanded) {
    expanded = over;
    el.notch.classList.toggle('expanded', over);
    window.notchApi.setInteractive(over);
    requestAnimationFrame(reportRect);
  }
});

// ---- rendering -------------------------------------------------------------

function tickClock() {
  const now = new Date();
  const showSeconds = state?.config?.showSeconds;
  el.clock.textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(showSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
  el.date.textContent = now.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function renderChips(s) {
  const key = JSON.stringify([s.config.presets, s.minutes, s.breaks, s.breakMinSession]);
  if (key === chipsFor) return;
  chipsFor = key;

  el.chips.replaceChildren();
  for (const m of s.config.presets) {
    const b = document.createElement('button');
    b.className = 'chip' + (s.minutes === m ? ' selected' : '');
    b.textContent = m;
    b.addEventListener('click', () => window.notchApi.action('minutes', m));
    el.chips.append(b);
  }

  // Breaks sits with the durations because that is what it depends on: it
  // dims for sessions too short to be worth splitting.
  const eligible = s.minutes * 60 >= s.breakMinSession;
  const br = document.createElement('button');
  br.className = 'chip breaks' + (s.breaks && eligible ? ' selected' : '');
  br.disabled = !eligible;
  br.title = eligible ? 'Breaks' : `Breaks apply from ${Math.round(s.breakMinSession / 60)} minutes`;
  const glyph = document.createElement('span');
  glyph.className = 'icon';
  setIcon(glyph, 'local_cafe');
  br.append(glyph);
  br.addEventListener('click', () => window.notchApi.action('breaks', !s.breaks));
  el.chips.append(br);
}

function renderProgress(s) {
  const slack = 3 * (s.plan.length - 1);
  el.progress.replaceChildren();
  s.plan.forEach((phase, i) => {
    const seg = document.createElement('div');
    seg.className = 'seg' + (phase.kind === 'break' ? ' break' : '');
    seg.style.flex = `0 0 calc((100% - ${slack}px) * ${phase.secs / s.planTotal})`;
    const fill = document.createElement('i');
    const done = i < s.phase ? 1 : i > s.phase ? 0 : 1 - s.remaining / phase.secs;
    fill.style.width = `${Math.min(100, Math.max(0, done * 100))}%`;
    seg.append(fill);
    el.progress.append(seg);
  });
}

function render(s) {
  state = s;
  const root = document.documentElement;
  root.style.setProperty('--scale', s.config.scale);
  for (const [k, v] of Object.entries(s.config.colours || {})) {
    root.style.setProperty(`--${k}`, v);
  }

  el.notch.classList.toggle('armed', s.active || s.finished);
  el.notch.classList.toggle('on-break', s.onBreak && !s.finished);
  el.notch.classList.toggle('finished', s.finished);
  el.notch.classList.toggle('playing', s.music.playing && !s.music.paused);
  el.notch.classList.toggle('multi', s.blocks > 1);

  setIcon(
    el.phaseIcon,
    s.finished ? 'timer_off' : s.onBreak ? 'local_cafe' : s.running ? 'hourglass_bottom' : 'pause'
  );
  el.countdown.textContent = s.finished ? 'done' : fmt(s.remaining);
  el.blocks.textContent = `${s.block}/${s.blocks}`;

  renderChips(s);

  // The duration is focus time; breaks are added on top. Say so, rather than
  // leaving it to be inferred.
  if (s.breaksApply) {
    const block = Math.round(s.plan[0].secs / 60);
    el.plan.textContent =
      `${s.blocks} × ${block} min · ${Math.round(s.breakLength / 60)} min breaks · ` +
      `${Math.round(s.planTotal / 60)} min total`;
  } else {
    el.plan.textContent = '';
  }

  setIcon(el.startIcon, s.running ? 'pause' : 'play_arrow');
  el.startLabel.textContent = s.running ? 'Pause' : s.active ? 'Resume' : 'Start';
  el.startBtn.classList.toggle('primary', !s.running);
  el.resetBtn.disabled = !(s.active || s.finished);
  el.skipBtn.hidden = !(s.onBreak && s.active);

  const m = s.music;
  el.musicBtn.classList.toggle('on', m.enabled && m.usable);
  el.musicBtn.classList.toggle('unavailable', !m.usable);
  setIcon(el.musicBox, m.enabled && m.usable ? 'check_box' : 'check_box_outline_blank');
  el.musicLabel.textContent = !m.usable
    ? 'Music (add links)'
    : m.playing && m.title
      ? m.title.length > 34
        ? m.title.slice(0, 33) + '…'
        : m.title
      : `Music · ${m.tracks}`;

  renderProgress(s);

  // The expanded height has to be measured, not guessed, or the panel clips.
  const controls = document.getElementById('controls');
  const h = 34 * s.config.scale + controls.scrollHeight;
  el.notch.style.setProperty('--expanded-height', `${Math.ceil(h)}px`);
  el.notch.style.minWidth = `calc(${s.config.minWidth}px * var(--scale))`;

  requestAnimationFrame(reportRect);
}

// ---- wiring ----------------------------------------------------------------

el.startBtn.addEventListener('click', () => {
  if (state?.finished) window.notchApi.action('dismissFinished');
  window.notchApi.action('toggle');
});
el.resetBtn.addEventListener('click', () => window.notchApi.action('reset'));
el.skipBtn.addEventListener('click', () => window.notchApi.action('skip'));
el.editBtn.addEventListener('click', () => window.notchApi.action('editPlaylist'));
el.musicBtn.addEventListener('click', () => {
  if (state?.music.usable) window.notchApi.action('music', !state.music.enabled);
});

window.notchApi.onState(render);
window.notchApi.onHidden((h) => el.notch.classList.toggle('hidden', h));
window.notchApi.onCue(({ file, volume }) => {
  const a = new Audio(`file://${file.replace(/\\/g, '/')}`);
  a.volume = Math.min(1, Math.max(0, volume));
  a.play().catch((err) => console.warn('cue failed:', err.message));
});

applyIcons();
tickClock();
setInterval(tickClock, 1000);
window.addEventListener('resize', reportRect);
