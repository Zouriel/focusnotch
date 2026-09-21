'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The renderers are views: they receive state and send intents. Nothing else
// from Node is exposed to them.
contextBridge.exposeInMainWorld('notchApi', {
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onHidden: (fn) => ipcRenderer.on('hidden', (_e, h) => fn(h)),
  onCue: (fn) => ipcRenderer.on('cue', (_e, c) => fn(c)),
  onPlayer: (fn) => ipcRenderer.on('player', (_e, m) => fn(m)),

  action: (type, value) => ipcRenderer.send('action', { type, value }),
  setInteractive: (on) => ipcRenderer.send('interactive', on),
  reportRect: (rect) => ipcRenderer.send('notch-rect', rect),
  playerState: (s) => ipcRenderer.send('player-state', s),
});
