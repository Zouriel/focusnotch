# Focus Notch for Windows

The Windows build of [focusnotch](https://github.com/Zouriel/focusnotch): a
notch at the top centre of the screen with a clock, a focus timer, breaks and
background music.

Same behaviour as the Linux build, rebuilt in Electron. None of the original
code carries over — the Linux version is Quickshell/QML on Wayland, which does
not exist on Windows — but the session logic is a direct port, so the two agree
on every plan they produce.

## Install

Grab the latest from [Releases](https://github.com/Zouriel/focusnotch/releases):

| File | |
| --- | --- |
| `FocusNotch-x.y.z-setup.exe` | installer, can start with Windows |
| `FocusNotch-x.y.z-portable.exe` | single file, just runs |

**The binaries are unsigned**, so SmartScreen will warn the first time:
*More info* → *Run anyway*. Signing needs a paid certificate. If you would
rather not take that on faith, the release is built from a tag by GitHub
Actions on a `windows-latest` runner and the log is public on the Actions tab.

It lives in the tray, not the taskbar. Right-click the tray icon for start,
pause, breaks, music, the config folder and quit.

## Using it

- **Hover the notch** for the panel: date, 5/10/15/30/60/90 chips, the breaks
  toggle, Start / Pause, Reset, the music tick and a button that opens the
  playlist.
- **The notch stays put.** It does not hide itself. On Linux it ducks out of
  the way so caelestia's top drawer can come down; Windows has nothing at the
  top edge to yield to, so hiding would only ever lose you the notch. If you
  want the gesture anyway, set `"hideOnTopEdge": true` and putting the cursor
  in the very top row, within the notch's own width, slides it away until you
  move off.
- **Hide the notch** from the tray menu when you want it gone for a while.
- **Stay on top of apps** in the tray controls whether the notch floats above
  other windows. Turn it off and it behaves like an ordinary window, so
  whatever you focus covers it. The break screen stays on top either way -
  interrupting is the entire point of it.
- **When the time is up** the screen takes over with a red, slowly pulsing
  card, and the chime repeats. A single soft ding and a small glow on the
  notch were easy to work straight through.
- **Breaks** split long sessions into work blocks. The duration you pick is
  focus time: 60 means 60 minutes of work, with breaks added on top. A break
  takes over the screen so you actually notice it; click anywhere to dismiss.

Global shortcuts: `Ctrl+Alt+F` start/pause, `Ctrl+Alt+R` reset, `Ctrl+Alt+S`
skip a break, `Ctrl+Alt+M` music.

## Music

Put YouTube links in `%APPDATA%\focusnotch\music.txt`, one per line, `| Label`
optional. The tray menu and the notch's pencil button both open it. Saved
changes are picked up immediately.

Two backends, chosen automatically:

- **mpv** — if `mpv` and `yt-dlp` are both on PATH. No ads, best quality. This
  is what the Linux build always uses. `winget install mpv yt-dlp` gets you
  there.
- **Embedded player** — otherwise. Nothing to install, but it is an ordinary
  YouTube embed, so ads play without Premium.

The notch re-checks every minute, so installing mpv later just starts working.

## Configuration

`%APPDATA%\focusnotch\config.json`, applied as soon as you save it. Same keys
as the Linux build, minus the ones that only mean something on Wayland. See the
[main README](../README.md#configuration); the Windows-specific ones are:

| Key | Default | |
| --- | --- | --- |
| `startWithWindows` | `false` | also togglable from the tray |
| `alwaysOnTop` | `true` | float above other windows; also in the tray |
| `hideOnTopEdge` | `false` | opt in to the top-edge hide gesture |
| `cursorPollMs` | `70` | how often the gesture is checked, when enabled |

## Building it yourself

```
cd windows
npm install
npm start          # run it
npm run dist       # build the exe into dist/
```

The three cue sounds are committed so a fresh clone just runs, but they are
generated: `npm run cues` rebuilds them from `config/gen-alarm.py`, the same
generator the Linux build uses, so the two platforms never drift apart.

`npm test` covers the break plan, the top-edge gesture, which card the overlay
shows, and that every icon a renderer asks for is in the bundled font.
`npm run preview:cards` screenshots the three overlay cards headlessly, which
is how they are checked without a desktop session.

`npm start` works on Linux and macOS too, which is how the UI is developed —
only the Windows window behaviour needs Windows.

## Third-party

The icons are a 3.3 KB subset of [Material Symbols
Rounded](https://github.com/google/material-design-icons) (Apache-2.0),
bundled in `assets/fonts/` with its licence. Bundled rather than required,
because the family is not on a stock Windows box - which is exactly what broke
in 1.0.1, where the ligature names rendered as the literal words and stretched
the buttons into paragraphs. Glyphs are addressed by codepoint now, so a font
that failed to load would cost one blank box rather than a sentence.
`npm run icons` rebuilds it; `npm test` fails if a renderer asks for an icon
the bundle does not contain.

## Known limitations

- **Fullscreen apps.** The Linux build hides the notch over fullscreen windows.
  Doing that on Windows needs a native module to query the foreground window,
  which this deliberately avoids. Exclusive-fullscreen games cover the notch
  anyway; borderless-fullscreen apps will have it sitting on top, and the
  top-edge gesture is the way out.
- **Primary display only.** The notch is placed on the primary monitor.
- **Unsigned**, as above.
