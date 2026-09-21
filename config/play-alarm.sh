#!/bin/sh
# Play the alarm through whatever this system actually has.
#
# Usage: play-alarm.sh <file> <volume 0.0-1.0>
# Override entirely by setting "alarmCommand" in config.json.

file="$1"
vol="${2:-0.6}"
[ -r "$file" ] || exit 1

# Integer percentage, for the players that want one.
pct=$(awk -v v="$vol" 'BEGIN { p = v * 100; if (p < 0) p = 0; if (p > 100) p = 100; printf "%d", p }')

if command -v pw-play >/dev/null 2>&1; then
    exec pw-play --volume "$vol" "$file"
elif command -v paplay >/dev/null 2>&1; then
    # PulseAudio wants 0-65536.
    pa=$(awk -v v="$vol" 'BEGIN { p = v * 65536; if (p < 0) p = 0; if (p > 65536) p = 65536; printf "%d", p }')
    exec paplay --volume="$pa" "$file"
elif command -v ffplay >/dev/null 2>&1; then
    exec ffplay -nodisp -autoexit -loglevel quiet -volume "$pct" "$file"
elif command -v canberra-gtk-play >/dev/null 2>&1; then
    exec canberra-gtk-play -f "$file"
elif command -v aplay >/dev/null 2>&1; then
    # No volume control here; the file itself is already quiet.
    exec aplay -q "$file"
elif command -v mpv >/dev/null 2>&1; then
    exec mpv --no-video --no-terminal --volume="$pct" "$file"
fi

echo "focusnotch: no audio player found (tried pw-play, paplay, ffplay, canberra-gtk-play, aplay, mpv)" >&2
exit 1
