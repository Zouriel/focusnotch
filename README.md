# focusnotch

A MacBook-style notch for Wayland: a small rounded bar at the top centre of the
screen that shows the time, runs a focus timer, plays background music from a
list of YouTube links, and gets out of the way when you reach for the top edge.

Built on [quickshell](https://quickshell.org). No compositor patching, no
desktop environment required — it is a layer-shell surface and nothing else.

```
              ┌──────────────────────────┐
              │  14:32  ·  ⧗ 24:17    ♪  │
              └──────────────────────────┘
                        hover ↓

              ┌──────────────────────────────────────┐
              │        14:32  ·  ⧗ 24:17  ♪          │
              │           Monday 21 September        │
              │      (5)(10)(15)[30](60)(90)         │
              │  [▶ Start] [↺] [☑ Music · 2]  [✎]    │
              │  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁              │
              └──────────────────────────────────────┘
```

## What it does

- **Clock**, always visible. Square where it meets the bezel, rounded
  underneath, so it reads as part of the hardware.
- **Focus timer** with 5 / 10 / 15 / 30 / 60 / 90 minute presets. Once armed,
  the notch shows the countdown next to the clock and a progress hairline along
  its bottom edge.
- **A subtle alarm.** A soft two-note chime, not an alert tone, plus an
  optional desktop notification. The notch border glows and pulses until you
  start something else.
- **Background music** from YouTube links you keep in a text file. Starting the
  timer starts the music, pausing pauses it, finishing fades it out over 2.5s.
- **Stays out of the way.** Hides when a window goes fullscreen, and when you
  put the cursor in the absolute top edge of the screen.

## Requirements

**Required**

| | |
| --- | --- |
| [quickshell](https://quickshell.org/docs/master/guide/install/) | the runtime |
| a wlroots-based Wayland compositor | Hyprland, Sway, river, Niri, … |
| `python3` | helper scripts, and generating the chime |
| the [Material Symbols Rounded](https://fonts.google.com/icons) font | the icons |

**Optional**

| | |
| --- | --- |
| any of `pw-play`, `paplay`, `ffplay`, `aplay`, `canberra-gtk-play`, `mpv` | the alarm sound; the first one found is used |
| `libnotify` (`notify-send`) | desktop notification when a session ends |
| `mpv` + `yt-dlp` | background music |

The installer tells you which of these you are missing.

## Install

```sh
git clone https://github.com/Zouriel/focusnotch
cd focusnotch
./install.sh          # or ./install.sh --link to symlink, for hacking on it
qs -c focusnotch -n -d
```

Autostart it from your compositor:

| Compositor | Line |
| --- | --- |
| Hyprland (conf) | `exec-once = qs -c focusnotch -n -d` |
| Hyprland (lua) | `hl.on("hyprland.start", function() hl.exec_cmd("qs -c focusnotch -n -d") end)` |
| Sway / river | `exec qs -c focusnotch -n -d` |
| Niri | `spawn-at-startup "qs" "-c" "focusnotch" "-n" "-d"` |

Uninstall with `./install.sh --uninstall`.

## Music

Put links in `~/.config/focusnotch/music.txt`, one per line. Anything after a
`|` is a label; `#` comments and blank lines are ignored. Livestreams work.

```
https://www.youtube.com/watch?v=jfKfPfyJRdk  | Lofi Girl
https://www.youtube.com/watch?v=4xDzrJKXOOY  | Synthwave radio
```

The pencil button next to the tick opens that file in whatever handles
`text/plain`. The file is re-read the moment you save it, so the track count
updates without a restart. Playback is `mpv --no-video` in shuffle with the
playlist looping, controlled over mpv's JSON IPC socket.

## Getting out of the way

This is the fiddly part, and there are two strategies. `edgeMode` picks one;
`auto` is the default.

**`hover`** — the notch claims the top few pixels as its own input region. Move
the cursor into them and it hides; move away and it returns. Works on any
compositor and needs nothing installed.

The catch: owning those pixels means nothing else can have them. If your bar or
shell uses the same band as a hover trigger — [caelestia](https://github.com/caelestia-dots/shell)'s
dashboard does — this silently breaks it.

**`pointer`** — the notch claims nothing at the top edge, and reads the cursor
position from the compositor instead. The top edge stays free for whatever else
wants it. Requires Hyprland, whose IPC can report the cursor position; there is
no portable Wayland equivalent.

`auto` uses `pointer` under Hyprland and `hover` everywhere else.

### Coexisting with another panel

In `pointer` mode the notch can also hide whenever *another* panel owns the top
of the screen, so the two never overlap. `topEdgeOwner` is a command that
prints `1` when that panel is open and `0` when it is not:

```json
"topEdgeOwner": ["qs", "-c", "caelestia", "ipc", "call", "drawers", "isOpen", "dashboard"]
```

`"auto"` uses exactly that caelestia command and quietly disables itself if
caelestia is not running. `"none"` turns it off.

Each call costs a process spawn (~20ms of CPU), so it only runs while the
cursor is in the top band or the notch is already hidden. Idle cost is zero.
The trade-off: a panel opened by **keybind**, with the cursor nowhere near the
top, is not noticed. Set `"alwaysWatchTopEdge": true` to cover that, at the
cost of polling constantly.

## Theming

Out of the box it uses a built-in dark palette. If [caelestia](https://github.com/caelestia-dots/shell)
is installed, its live colour scheme and fonts are used instead, so the notch
rethemes along with your wallpaper. Anything in `colours` overrides both:

```json
"colours": { "primary": "#f5c2e7", "onPrimary": "#1e1e2e", "notchBg": "#11111b" }
```

Keys: `notchBg`, `onSurface`, `onSurfaceVariant`, `outline`, `primary`,
`onPrimary`.

## Configuration

`~/.config/focusnotch/config.json`. Edits apply immediately — no restart.

| Key | Default | |
| --- | --- | --- |
| `scale` | `1.0` | overall size multiplier |
| `presets` | `[5,10,15,30,60,90]` | the duration chips |
| `defaultMinutes` | `30` | first-run selection |
| `minWidth` | `250` | minimum collapsed width |
| `showSeconds` | `false` | seconds on the clock |
| `alarmVolume` | `0.55` | chime volume, 0–1 |
| `alarmCommand` | `[]` | override the alarm player; `{}` is the sound file |
| `notify` | `true` | desktop notification on completion |
| `musicVolume` | `45` | mpv volume |
| `editorCommand` | `[]` | playlist editor; `{}` is the path. Empty means `xdg-open` |
| `edgeMode` | `"auto"` | `auto`, `pointer` or `hover` |
| `topTriggerPx` | `3` | height of the top-edge band |
| `revealDelayMs` | `150` | delay before reappearing |
| `cursorPollSeconds` | `0.07` | cursor watcher interval (pointer mode) |
| `topEdgeOwner` | `"auto"` | command reporting another panel's state |
| `topEdgeOwnerPollMs` | `150` | how often to ask it |
| `alwaysWatchTopEdge` | `false` | poll around the clock |
| `hideOnFullscreen` | `true` | hide over fullscreen windows |
| `colours` | `{}` | palette overrides |

## Control from a terminal or keybind

```sh
qs -c focusnotch ipc call focus status
qs -c focusnotch ipc call focus toggle       # start / pause
qs -c focusnotch ipc call focus set 45       # any number of minutes
qs -c focusnotch ipc call focus reset
qs -c focusnotch ipc call focus music toggle
qs -c focusnotch ipc call notch state        # hidden / cursor / edge mode
```

Handy for keybinds:

```
bind = SUPER SHIFT, F, exec, qs -c focusnotch ipc call focus toggle
```

## How it is put together

| | |
| --- | --- |
| `shell/Notch.qml` | the layer-shell window: geometry, hide logic, layout |
| `shell/Focus.qml` | the session: countdown, chime, notification, persistence |
| `shell/Music.qml` | mpv lifecycle and the playlist file |
| `shell/Theme.qml` | palette, fonts and config, all live-reloaded |
| `config/cursor-watch.py` | streams the cursor position from Hyprland's IPC |
| `config/mpvctl.py` | mpv JSON IPC client: titles, pause, fade-out |
| `config/play-alarm.sh` | picks whichever audio player exists |
| `config/gen-alarm.py` | writes the chime as a WAV, no audio libraries needed |

The notch shape is a rectangle offset upward by exactly its own corner radius
inside a clipping parent, so the top corners are cropped away and the bottom
two stay round.

Duration and the music tick persist to `~/.local/state/focusnotch/state.json`.
A running countdown does not: restarting the shell clears it.

## Known limitations

- `pointer` mode needs Hyprland. Everywhere else, `hover` claims the top few
  pixels, which can conflict with another panel's hover trigger.
- A coexisting panel opened by keybind is not noticed unless
  `alwaysWatchTopEdge` is on.
- Multi-monitor: the notch is drawn on every screen, but the coexistence check
  and the IPC handler only report for the first one.
- Tested on Hyprland. Other wlroots compositors should work — the only
  Hyprland-specific piece is the cursor watcher — but are untested. Reports
  welcome.

## Licence

MIT. See [LICENSE](LICENSE).
