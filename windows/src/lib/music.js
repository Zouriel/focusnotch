'use strict';

/**
 * Background music.
 *
 * Two backends, picked at runtime:
 *
 *   mpv   - if mpv and yt-dlp are both on PATH. No ads, best quality, and
 *           controlled over mpv's JSON IPC (a named pipe on Windows, a unix
 *           socket elsewhere). This is what the Linux build always uses.
 *
 *   embed - otherwise: a hidden window running YouTube's IFrame player.
 *           Needs nothing installed, but plays ads without Premium.
 */

const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');

const IS_WIN = process.platform === 'win32';
const PIPE = IS_WIN
  ? '\\\\.\\pipe\\focusnotch-mpv'
  : path.join(os.tmpdir(), `focusnotch-mpv-${process.pid}.sock`);

function onPath(cmd) {
  try {
    const probe = spawnSync(IS_WIN ? 'where' : 'which', [cmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return probe.status === 0 && String(probe.stdout).trim().length > 0;
  } catch {
    return false;
  }
}

class Music extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;

    this.enabled = false;
    this.title = '';
    this.paused = false;

    this.proc = null;
    this.sock = null;
    this._buf = '';
    this._fading = false;

    // Set by main once the hidden player window exists.
    this.embedBridge = null;

    this.probe();
    // Re-probe so installing mpv later starts working without a restart.
    this._probeTimer = setInterval(() => this.probe(), 60000);
  }

  probe() {
    const was = this.hasMpv;
    this.hasMpv = onPath('mpv') && onPath('yt-dlp');
    if (was !== this.hasMpv) this.emit('changed');
  }

  get mode() {
    return this.hasMpv ? 'mpv' : 'embed';
  }
  get tracks() {
    return this.config.tracks;
  }
  get usable() {
    return this.tracks.length > 0;
  }
  get playing() {
    return this.mode === 'mpv' ? !!this.proc : this._embedPlaying === true;
  }

  // ---- lifecycle -----------------------------------------------------------

  start() {
    if (!this.usable || this.playing) return;
    this.title = '';
    this.paused = false;
    this._fading = false;
    if (this.mode === 'mpv') this._startMpv();
    else this._embed('load', { tracks: this.tracks, volume: this.config.get('musicVolume', 45) });
    this.emit('changed');
  }

  setPaused(p) {
    if (!this.playing) return;
    this.paused = !!p;
    if (this.mode === 'mpv') this._mpvCommand(['set_property', 'pause', this.paused]);
    else this._embed(this.paused ? 'pause' : 'play');
    this.emit('changed');
  }

  /** Hard stop: reset, or the tick being turned off. */
  stop() {
    this.paused = false;
    this.title = '';
    this._fading = false;
    if (this.proc) {
      this._mpvCommand(['quit']);
      const p = this.proc;
      this.proc = null;
      setTimeout(() => {
        try {
          p.kill();
        } catch {}
      }, 400);
    }
    this._embed('stop');
    this._embedPlaying = false;
    this.emit('changed');
  }

  /** Session complete: ramp down rather than cutting off mid-note. */
  fadeStop(seconds = 2.5) {
    if (!this.playing) {
      this.stop();
      return;
    }
    if (this._fading) return;
    this._fading = true;

    const start = this.config.get('musicVolume', 45);
    const steps = Math.max(1, Math.round(seconds / 0.08));
    let i = 0;
    const step = setInterval(() => {
      i += 1;
      const vol = Math.max(0, start * (1 - i / steps));
      if (this.mode === 'mpv') this._mpvCommand(['set_property', 'volume', vol]);
      else this._embed('volume', { volume: vol });
      if (i >= steps) {
        clearInterval(step);
        this.stop();
      }
    }, (seconds * 1000) / steps);
  }

  destroy() {
    clearInterval(this._probeTimer);
    clearInterval(this._titleTimer);
    this.stop();
  }

  // ---- mpv backend ---------------------------------------------------------

  _startMpv() {
    const args = [
      '--no-video',
      '--no-terminal',
      '--idle=no',
      '--shuffle',
      '--loop-playlist=inf',
      '--ytdl-format=bestaudio/best',
      `--volume=${this.config.get('musicVolume', 45)}`,
      `--input-ipc-server=${PIPE}`,
      ...this.tracks.map((t) => t.url),
    ];

    this.proc = spawn('mpv', args, { stdio: 'ignore', windowsHide: true });
    this.proc.on('exit', () => {
      this.proc = null;
      this.title = '';
      this.paused = false;
      this._closeSock();
      this.emit('changed');
    });
    this.proc.on('error', (err) => {
      console.warn('focusnotch: mpv failed to start:', err.message);
      this.proc = null;
      this.emit('changed');
    });

    setTimeout(() => this._connect(), 700);

    clearInterval(this._titleTimer);
    this._titleTimer = setInterval(() => {
      if (this.proc) this._mpvCommand(['get_property', 'media-title'], 'title');
    }, 4000);
  }

  _connect() {
    if (!this.proc || this.sock) return;
    const sock = net.connect(IS_WIN ? { path: PIPE } : PIPE);
    sock.on('connect', () => {
      this.sock = sock;
      this._mpvCommand(['get_property', 'media-title'], 'title');
    });
    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('error', () => {
      this.sock = null;
      // mpv may not have created the pipe yet; try again shortly.
      if (this.proc) setTimeout(() => this._connect(), 800);
    });
    sock.on('close', () => {
      this.sock = null;
    });
  }

  _onData(chunk) {
    this._buf += chunk.toString();
    let idx;
    while ((idx = this._buf.indexOf('\n')) !== -1) {
      const line = this._buf.slice(0, idx).trim();
      this._buf = this._buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.request_id === 1 && msg.error === 'success' && typeof msg.data === 'string') {
          if (msg.data && msg.data !== this.title) {
            this.title = msg.data;
            this.emit('changed');
          }
        }
      } catch {
        /* mpv also emits events we do not care about */
      }
    }
  }

  _mpvCommand(command, tag) {
    if (!this.sock) return;
    const payload = { command };
    if (tag === 'title') payload.request_id = 1;
    try {
      this.sock.write(JSON.stringify(payload) + '\n');
    } catch {
      this.sock = null;
    }
  }

  _closeSock() {
    if (this.sock) {
      try {
        this.sock.destroy();
      } catch {}
      this.sock = null;
    }
  }

  // ---- embedded player backend --------------------------------------------

  _embed(cmd, args = {}) {
    if (this.mode !== 'embed' || !this.embedBridge) return;
    if (cmd === 'load') this._embedPlaying = true;
    if (cmd === 'stop') this._embedPlaying = false;
    this.embedBridge(cmd, args);
  }

  /** Called by main when the hidden player reports what it is playing. */
  onEmbedState({ title, playing }) {
    if (typeof title === 'string' && title && title !== this.title) this.title = title;
    if (typeof playing === 'boolean') this._embedPlaying = playing;
    this.emit('changed');
  }

  snapshot() {
    return {
      enabled: this.enabled,
      mode: this.mode,
      hasMpv: !!this.hasMpv,
      usable: this.usable,
      playing: this.playing,
      paused: this.paused,
      title: this.title,
      tracks: this.tracks.length,
    };
  }
}

module.exports = { Music };
