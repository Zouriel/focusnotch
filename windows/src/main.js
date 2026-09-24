'use strict';

const path = require('path');
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require('electron');

const { Config } = require('./lib/config');
const { Session } = require('./lib/session');
const { Music } = require('./lib/music');
const { EdgeWatcher, inTopEdge } = require('./lib/edge');

const ASSETS = path.join(__dirname, '..', 'assets');

let config;
let session;
let music;

let notchWin = null;
let overlayWin = null;
let playerWin = null;
let tray = null;

// The notch's own footprint in screen coordinates, reported by the renderer.
// The top-edge gesture only fires within it, so the rest of the screen edge
// stays yours.
let notchRect = null;
let hidden = false;
let userHidden = false;
let edge = null;
let cursorTimer = null;
let interactive = false;

// Only one instance: a second notch on screen helps nobody.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => notchWin?.webContents.send('flash'));
  app.whenReady().then(main);
}

function main() {
  app.setAppUserModelId('dev.zouriel.focusnotch');

  // FOCUSNOTCH_DIR lets a dev run against a scratch config instead of the
  // real one. On Windows this resolves to %APPDATA%\\focusnotch.
  config = new Config(process.env.FOCUSNOTCH_DIR || path.join(app.getPath('appData'), 'focusnotch'));
  session = new Session(config);
  music = new Music(config);

  restoreState();
  createWindows();
  createTray();
  wireSession();
  wireMusic();
  registerShortcuts();
  startCursorWatch();

  config.on('changed', () => {
    applyAutostart();
    startCursorWatch();
    broadcast();
  });
  config.on('playlist', broadcast);

  applyAutostart();
  if (process.env.FOCUSNOTCH_CAPTURE) captureAndExit(process.env.FOCUSNOTCH_CAPTURE);

  app.on('window-all-closed', (e) => e.preventDefault()); // tray app
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    clearInterval(cursorTimer);
    music?.destroy();
    session?.destroy();
  });
}

// ---------------------------------------------------------------- windows ---

function primary() {
  return screen.getPrimaryDisplay();
}

function createWindows() {
  const d = primary();

  // A fixed, transparent, click-through window. The notch itself is a CSS
  // element inside it that grows on hover -- far smoother than resizing a
  // real window on every frame, and it keeps the top screen edge free.
  const width = Math.min(1100, d.bounds.width);
  notchWin = new BrowserWindow({
    x: Math.round(d.bounds.x + (d.bounds.width - width) / 2),
    y: d.bounds.y,
    width,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    acceptFirstMouse: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  notchWin.setAlwaysOnTop(true, 'screen-saver');
  notchWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notchWin.setIgnoreMouseEvents(true, { forward: true });
  notchWin.loadFile(path.join(__dirname, 'renderer', 'notch.html'));
  notchWin.once('ready-to-show', broadcast);

  overlayWin = new BrowserWindow({
    ...displayBounds(d),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  playerWin = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  playerWin.loadFile(path.join(__dirname, 'renderer', 'player.html'));
  music.embedBridge = (cmd, args) => playerWin?.webContents.send('player', { cmd, args });

  screen.on('display-metrics-changed', repositionWindows);
  screen.on('display-added', repositionWindows);
  screen.on('display-removed', repositionWindows);
}

function displayBounds(d) {
  return { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
}

function repositionWindows() {
  const d = primary();
  if (notchWin && !notchWin.isDestroyed()) {
    const width = Math.min(1100, d.bounds.width);
    notchWin.setBounds({
      x: Math.round(d.bounds.x + (d.bounds.width - width) / 2),
      y: d.bounds.y,
      width,
      height: 320,
    });
  }
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setBounds(displayBounds(d));
}

// ------------------------------------------------------------ top edge -----

/**
 * The gesture: the cursor reaching the absolute top row of the screen, within
 * the notch's own span, means "get out of my way".
 *
 * Off by default. On Linux it exists so caelestia's top drawer can come down;
 * Windows has nothing at the top edge to yield to, so a notch that vanishes is
 * just a notch you lost. Turn it on with "hideOnTopEdge": true.
 *
 * The notch window never claims those pixels -- it is click-through -- so this
 * reads the cursor from the OS rather than relying on an input region.
 */
function startCursorWatch() {
  clearInterval(cursorTimer);
  cursorTimer = null;

  if (!config.get('hideOnTopEdge', false)) {
    // Dropping the watcher also drops its opinion, so anything it was hiding
    // comes straight back rather than being stranded off screen.
    edge = null;
    applyHidden();
    return;
  }

  edge = new EdgeWatcher({ revealDelayMs: config.get('revealDelayMs', 150) });
  const period = Math.max(30, config.get('cursorPollMs', 70));
  const band = Math.max(2, config.get('topTriggerPx', 3));

  cursorTimer = setInterval(() => {
    if (!notchRect) return;
    const changed = edge.update(
      inTopEdge(screen.getCursorScreenPoint(), primary().bounds, notchRect, band)
    );
    if (changed) applyHidden();
  }, period);
}

/** Hidden if the gesture says so, or if you asked for it from the tray. */
function applyHidden() {
  const next = userHidden || !!edge?.hidden;
  if (hidden === next) return;
  hidden = next;
  // While hidden the notch must not swallow clicks meant for what is beneath.
  if (hidden) setInteractive(false);
  notchWin?.webContents.send('hidden', hidden);
  refreshTray();
}

function setInteractive(next) {
  if (interactive === next || !notchWin || notchWin.isDestroyed()) return;
  interactive = next;
  notchWin.setIgnoreMouseEvents(!next, { forward: true });
}

// ------------------------------------------------------------- session -----

function wireSession() {
  session.on('changed', broadcast);
  session.on('tick', broadcast);
  session.on('persist', persistState);

  session.on('started', () => {
    if (music.enabled) {
      if (music.playing) music.setPaused(false);
      else music.start();
    }
  });
  session.on('paused', () => {
    if (music.playing) music.setPaused(true);
  });
  session.on('reset', () => music.stop());

  session.on('breakStarted', ({ minutes }) => {
    cue('break-start.wav');
    notify('Break time', `${minutes} minute${minutes === 1 ? '' : 's'}. Step away.`);
  });
  session.on('breakEnded', ({ block, blocks }) => {
    cue('break-end.wav');
    notify('Back to it', `Block ${block} of ${blocks}.`);
  });
  session.on('completed', ({ minutes }) => {
    cue('alarm.wav');
    notify('Focus session done', `${minutes} minute${minutes === 1 ? '' : 's'} of focus finished.`);
    music.fadeStop();
  });
}

function wireMusic() {
  music.on('changed', broadcast);
}

function broadcast() {
  const state = {
    ...session.snapshot(),
    music: music.snapshot(),
    config: {
      scale: config.get('scale', 1),
      presets: config.get('presets'),
      minWidth: config.get('minWidth', 250),
      showSeconds: config.get('showSeconds', false),
      dimOpacity: config.get('breakOverlay', {}).dimOpacity ?? 0.6,
      colours: config.get('colours', {}),
    },
    hidden,
  };
  notchWin?.webContents.send('state', state);
  overlayWin?.webContents.send('state', state);

  const wantOverlay = state.showBreakScreen;
  if (overlayWin && !overlayWin.isDestroyed()) {
    if (wantOverlay && !overlayWin.isVisible()) {
      overlayWin.setBounds(displayBounds(primary()));
      overlayWin.showInactive();
      overlayWin.setAlwaysOnTop(true, 'screen-saver');
    } else if (!wantOverlay && overlayWin.isVisible()) {
      // Let the fade finish before the window goes.
      setTimeout(() => {
        if (!session.showBreakScreen && overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
      }, 280);
    }
  }
}

function persistState() {
  config.saveState({
    minutes: session.minutes,
    breaks: session.breaksEnabled,
    music: music.enabled,
  });
}

function restoreState() {
  const s = config.loadState();
  if (s.minutes > 0) session.minutes = s.minutes;
  session.breaksEnabled = !!s.breaks;
  music.enabled = !!s.music;
  session.rebuild();
}

// ---------------------------------------------------------------- cues -----

function cue(file) {
  notchWin?.webContents.send('cue', {
    file: path.join(ASSETS, file),
    volume: config.get('alarmVolume', 0.55),
  });
}

function notify(title, body) {
  if (!config.get('notify', true)) return;
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body, silent: true }).show();
  } catch (err) {
    console.warn('focusnotch: notification failed:', err.message);
  }
}

// ---------------------------------------------------------------- tray -----

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Focus Notch');
  refreshTray();
  tray.on('click', () => session.toggle());
  session.on('changed', refreshTray);
}

function refreshTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: session.running ? 'Pause' : session.active ? 'Resume' : 'Start', click: () => session.toggle() },
    { label: 'Reset', click: () => session.reset(), enabled: session.active || session.finished },
    { type: 'separator' },
    {
      label: 'Breaks',
      type: 'checkbox',
      checked: session.breaksEnabled,
      click: (i) => session.setBreaks(i.checked),
    },
    {
      label: 'Music',
      type: 'checkbox',
      checked: music.enabled,
      click: (i) => setMusicEnabled(i.checked),
    },
    {
      label: 'Hide the notch',
      type: 'checkbox',
      checked: userHidden,
      click: (i) => {
        userHidden = i.checked;
        applyHidden();
      },
    },
    { type: 'separator' },
    { label: 'Preview break screen', click: () => session.preview('break') },
    { label: 'Edit playlist', click: () => shell.openPath(config.musicPath) },
    { label: 'Open config folder', click: () => shell.openPath(config.dir) },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: config.get('startWithWindows', false),
      click: (i) => {
        config.values.startWithWindows = i.checked;
        applyAutostart();
      },
    },
    { label: 'Quit', click: () => app.exit(0) },
  ]);
  tray.setContextMenu(menu);
}

function applyAutostart() {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!config.get('startWithWindows', false),
      args: [],
    });
  } catch (err) {
    console.warn('focusnotch: could not set autostart:', err.message);
  }
}

function setMusicEnabled(on) {
  music.enabled = !!on;
  // Ticking the box mid-session takes effect straight away, not at next Start.
  if (!music.enabled) music.stop();
  else if (session.running && !music.playing) music.start();
  persistState();
  broadcast();
}

// --------------------------------------------------------------- input -----

function registerShortcuts() {
  const binds = [
    ['Control+Alt+F', () => session.toggle()],
    ['Control+Alt+R', () => session.reset()],
    ['Control+Alt+M', () => setMusicEnabled(!music.enabled)],
    ['Control+Alt+S', () => session.skip()],
  ];
  for (const [accel, fn] of binds) {
    try {
      if (!globalShortcut.register(accel, fn)) {
        console.warn(`focusnotch: ${accel} is already taken by something else`);
      }
    } catch (err) {
      console.warn(`focusnotch: could not register ${accel}:`, err.message);
    }
  }
}

ipcMain.on('interactive', (_e, on) => {
  if (hidden) return; // never take clicks while out of the way
  setInteractive(!!on);
});

ipcMain.on('notch-rect', (_e, rect) => {
  notchRect = rect;
});

ipcMain.on('action', (_e, { type, value }) => {
  switch (type) {
    case 'toggle':
      session.toggle();
      break;
    case 'reset':
      session.reset();
      break;
    case 'skip':
      session.skip();
      break;
    case 'minutes':
      session.setMinutes(value);
      break;
    case 'breaks':
      session.setBreaks(value);
      break;
    case 'music':
      setMusicEnabled(value);
      break;
    case 'editPlaylist':
      shell.openPath(config.musicPath);
      break;
    case 'dismissBreak':
      session.dismissBreakScreen();
      break;
    case 'dismissFinished':
      session.dismissFinished();
      break;
    case 'preview':
      session.preview(value || 'break');
      break;
    default:
      break;
  }
});

ipcMain.on('player-state', (_e, state) => music.onEmbedState(state || {}));

// ------------------------------------------------------------- capture -----

/**
 * Screenshot the windows and exit. Used to eyeball the UI without a desktop
 * (and to check renders in CI), never in normal operation.
 */
async function captureAndExit(dir) {
  const fs = require('fs');
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  };

  try {
    await wait(2500);
    await shot(notchWin, 'notch-collapsed');

    session.setMinutes(60);
    session.setBreaks(true);
    await wait(400);
    await notchWin.webContents.executeJavaScript(
      "document.getElementById('notch').classList.add('expanded'); true"
    );
    await wait(600);
    await shot(notchWin, 'notch-expanded');

    session.start();
    await wait(1200);
    await shot(notchWin, 'notch-running');

    session.preview('break');
    await wait(900);
    await shot(overlayWin, 'break-screen');

    session.dismissBreakScreen();
    session.preview('back');
    await wait(900);
    await shot(overlayWin, 'back-to-work');

    console.log('captured to', dir);
  } catch (err) {
    console.error('capture failed:', err);
  }
  app.exit(0);
}
