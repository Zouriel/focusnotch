'use strict';

/**
 * Config, playlist and persisted state, all live-reloaded.
 *
 * Everything lives beside the app's user data so it survives updates:
 *   %APPDATA%\focusnotch\config.json
 *   %APPDATA%\focusnotch\music.txt
 *   %APPDATA%\focusnotch\state.json
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULTS = {
  scale: 1.0,

  presets: [5, 10, 15, 30, 60, 90],
  defaultMinutes: 30,
  minWidth: 250,
  showSeconds: false,

  breaks: { minSessionMinutes: 30, everyMinutes: 20, lengthMinutes: 5 },
  breakOverlay: { enabled: true, dimOpacity: 0.6, backToWorkSeconds: 6 },

  alarmVolume: 0.55,
  // The end of a session repeats; break cues always play once.
  alarmRepeats: 3,
  notify: true,

  musicVolume: 45,

  // Off by default: on Linux the notch hides so caelestia's top drawer can come
  // down, but Windows has nothing at the top edge to yield to.
  hideOnTopEdge: false,
  topTriggerPx: 3,
  revealDelayMs: 150,
  cursorPollMs: 70,

  startWithWindows: false,
  // Keep the notch above other windows. Off drops it to an ordinary window,
  // so anything you focus covers it.
  alwaysOnTop: true,

  colours: {},
};

const DEFAULT_PLAYLIST = `# Focus music for the notch.
#
# One YouTube link per line. Livestreams and normal videos both work.
# Everything after a "|" is used as a display label (optional).
# Lines starting with "#" and blank lines are ignored.
# The notch reloads this file the moment you save it.

https://www.youtube.com/watch?v=jfKfPfyJRdk  | Lofi Girl - beats to relax/study to
https://www.youtube.com/watch?v=4xDzrJKXOOY  | Lofi Girl - synthwave radio

# Add your own below.
`;

class Config extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.configPath = path.join(dir, 'config.json');
    this.musicPath = path.join(dir, 'music.txt');
    this.statePath = path.join(dir, 'state.json');

    this.values = { ...DEFAULTS };
    this.tracks = [];

    fs.mkdirSync(dir, { recursive: true });
    this._seed();
    this.reload();
    this.reloadPlaylist();
    this._watch();
  }

  _seed() {
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, JSON.stringify(DEFAULTS, null, 2) + '\n');
    }
    if (!fs.existsSync(this.musicPath)) {
      fs.writeFileSync(this.musicPath, DEFAULT_PLAYLIST);
    }
  }

  get(key, fallback) {
    const v = this.values[key];
    return v === undefined || v === null ? (fallback !== undefined ? fallback : DEFAULTS[key]) : v;
  }

  reload() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      // Shallow merge so a partial config.json still gets every default.
      this.values = { ...DEFAULTS, ...parsed };
      for (const k of ['breaks', 'breakOverlay']) {
        this.values[k] = { ...DEFAULTS[k], ...(parsed[k] || {}) };
      }
      this.emit('changed');
    } catch (err) {
      console.warn('focusnotch: could not read config.json:', err.message);
    }
  }

  reloadPlaylist() {
    try {
      const text = fs.readFileSync(this.musicPath, 'utf8');
      const out = [];
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        const bar = line.indexOf('|');
        const url = (bar === -1 ? line : line.slice(0, bar)).trim();
        const label = bar === -1 ? '' : line.slice(bar + 1).trim();
        if (!url.startsWith('http')) continue;

        out.push({ url, label: label || url.replace(/^https?:\/\/(www\.)?/, '') });
      }
      this.tracks = out;
      this.emit('playlist');
    } catch (err) {
      console.warn('focusnotch: could not read music.txt:', err.message);
    }
  }

  loadState() {
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch {
      return {};
    }
  }

  saveState(state) {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2) + '\n');
    } catch (err) {
      console.warn('focusnotch: could not write state.json:', err.message);
    }
  }

  _watch() {
    // Editors commonly save by renaming a temp file over the original, which
    // breaks a watch on the file itself. Watch the directory instead.
    let debounce = null;
    try {
      fs.watch(this.dir, (_event, filename) => {
        if (!filename) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (filename === 'config.json') this.reload();
          else if (filename === 'music.txt') this.reloadPlaylist();
        }, 120);
      });
    } catch (err) {
      console.warn('focusnotch: config watching unavailable:', err.message);
    }
  }
}

module.exports = { Config, DEFAULTS };
