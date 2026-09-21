#!/usr/bin/env bash
# Install focusnotch into ~/.config. Safe to re-run.
#
#   ./install.sh            copy the files
#   ./install.sh --link     symlink instead, for hacking on the repo
#   ./install.sh --uninstall

set -euo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
SHELL_DIR="$CONFIG_HOME/quickshell/focusnotch"
CONF_DIR="$CONFIG_HOME/focusnotch"

MODE=copy
for arg in "$@"; do
    case "$arg" in
        --link) MODE=link ;;
        --uninstall) MODE=uninstall ;;
        -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

say()  { printf '\033[1;34m::\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }

if [ "$MODE" = uninstall ]; then
    say "Stopping the shell"
    qs -c focusnotch kill 2>/dev/null || true
    rm -rf "$SHELL_DIR"
    say "Removed $SHELL_DIR"
    warn "Left $CONF_DIR alone (it has your config.json and music.txt)."
    warn "Remove it yourself with: rm -rf '$CONF_DIR' '$STATE_HOME/focusnotch'"
    warn "Also remove the autostart line you added to your compositor config."
    exit 0
fi

command -v qs >/dev/null 2>&1 || command -v quickshell >/dev/null 2>&1 || {
    echo "quickshell is not installed. See https://quickshell.org/docs/master/guide/install/" >&2
    exit 1
}

say "Installing shell into $SHELL_DIR"
rm -rf "$SHELL_DIR"
mkdir -p "$SHELL_DIR" "$CONF_DIR" "$STATE_HOME/focusnotch"

if [ "$MODE" = link ]; then
    rmdir "$SHELL_DIR"
    ln -s "$REPO/shell" "$SHELL_DIR"
else
    cp "$REPO"/shell/*.qml "$SHELL_DIR/"
fi

say "Installing helpers into $CONF_DIR"
for f in gen-alarm.py mpvctl.py cursor-watch.py play-alarm.sh; do
    cp "$REPO/config/$f" "$CONF_DIR/$f"
    chmod +x "$CONF_DIR/$f"
done

# Never clobber the things the user edits.
for f in config.json music.txt; do
    if [ -e "$CONF_DIR/$f" ]; then
        say "Keeping your existing $f"
    else
        cp "$REPO/config/$f" "$CONF_DIR/$f"
    fi
done

# alarm.wav = session done, break-start/break-end = the two break cues.
missing_cue=
for cue in alarm.wav break-start.wav break-end.wav; do
    [ -f "$CONF_DIR/$cue" ] || missing_cue=1
done
if [ -n "$missing_cue" ]; then
    say "Generating the cue sounds"
    python3 "$CONF_DIR/gen-alarm.py" "$CONF_DIR"
fi

# ---- dependency report -----------------------------------------------------

missing=()
have() { command -v "$1" >/dev/null 2>&1; }

have python3 || missing+=("python3 (required)")

if ! have pw-play && ! have paplay && ! have ffplay && ! have aplay && ! have canberra-gtk-play && ! have mpv; then
    missing+=("an audio player: pipewire / pulseaudio-utils / ffmpeg / alsa-utils (for the alarm)")
fi
have notify-send || missing+=("libnotify (optional, desktop notification when a session ends)")
have mpv        || missing+=("mpv (optional, background music)")
have yt-dlp     || missing+=("yt-dlp (optional, background music from YouTube)")

# Not `fc-list | grep -q`: under `set -o pipefail`, grep -q exits early and
# SIGPIPEs fc-list, which makes the whole pipeline look like a failure.
if have fc-list; then
    fonts="$(fc-list : family 2>/dev/null || true)"
    case "$fonts" in
        *"Material Symbols"*) ;;
        *) missing+=("the 'Material Symbols Rounded' font (icons will show as boxes without it)") ;;
    esac
fi

if [ ${#missing[@]} -gt 0 ]; then
    echo
    warn "Missing or optional:"
    for m in "${missing[@]}"; do echo "     - $m"; done
    echo
    echo "   Arch:     sudo pacman -S --needed libpipewire libnotify mpv yt-dlp ttf-material-symbols-variable-git"
    echo "   Fedora:   sudo dnf install pipewire-utils libnotify mpv yt-dlp"
    echo "   Debian:   sudo apt install pipewire-bin libnotify-bin mpv yt-dlp"
    echo "   openSUSE: sudo zypper install pipewire-tools libnotify-tools mpv yt-dlp"
fi

cat <<MSG

Done. Start it with:

    qs -c focusnotch -n -d

Autostart, depending on your compositor:

    Hyprland (conf)  exec-once = qs -c focusnotch -n -d
    Hyprland (lua)   hl.on("hyprland.start", function() hl.exec_cmd("qs -c focusnotch -n -d") end)
    Sway / river     exec qs -c focusnotch -n -d
    Niri             spawn-at-startup "qs" "-c" "focusnotch" "-n" "-d"

Config lives in $CONF_DIR/config.json and applies as soon as you save it.
MSG
