#!/usr/bin/env python3
"""Generate the focus notch's cue sounds.

  gen-alarm.py <dir-or-file>    write all three cues into a directory,
                                or just alarm.wav if given a .wav path

Three deliberately quiet sounds, all sine-based with an exponential decay so
they read as a chime rather than an alert:

  alarm.wav        session finished  - falling third, the longest of the three
  break-start.wav  time for a break  - one low note, an exhale
  break-end.wav    back to work      - rising pair, slightly brighter
"""
import math
import os
import struct
import sys
import wave

RATE = 48000


def note(freq, dur, amp, start, buf, decay=2.6):
    """Additive sine with a soft exponential decay, mixed into buf at `start` s."""
    n = int(dur * RATE)
    off = int(start * RATE)
    attack = int(0.008 * RATE)
    for i in range(n):
        t = i / RATE
        env = math.exp(-t * decay)
        if i < attack:
            env *= i / attack
        v = (
            math.sin(2 * math.pi * freq * t)
            + 0.22 * math.sin(2 * math.pi * freq * 2 * t)
            + 0.07 * math.sin(2 * math.pi * freq * 3 * t)
        )
        j = off + i
        if j < len(buf):
            buf[j] += v * env * amp


def write(path, seconds, voices):
    buf = [0.0] * int(seconds * RATE)
    for v in voices:
        note(*v, buf=buf)

    frames = bytearray()
    for v in buf:
        s = max(-1.0, min(1.0, v))
        frames += struct.pack("<hh", int(s * 32767), int(s * 32767))

    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))


# (freq, duration, amplitude, start)
CUES = {
    # E5 then C5: a gentle falling third, not an alert.
    "alarm.wav": (3.2, [
        (659.25, 2.2, 0.16, 0.00),
        (523.25, 2.6, 0.14, 0.42),
        (261.63, 2.8, 0.05, 0.42),
    ]),
    # One low note, left to ring out. Unmistakably not the end of the session.
    "break-start.wav": (2.2, [
        (392.00, 2.0, 0.14, 0.00),
        (196.00, 2.0, 0.05, 0.00),
    ]),
    # C5 then G5 rising: a nudge back to it.
    "break-end.wav": (2.0, [
        (523.25, 1.4, 0.12, 0.00),
        (783.99, 1.6, 0.12, 0.26),
    ]),
}


def main(argv):
    target = argv[1] if len(argv) > 1 else "."
    if target.endswith(".wav"):
        seconds, voices = CUES["alarm.wav"]
        write(target, seconds, voices)
        return 0

    os.makedirs(target, exist_ok=True)
    for name, (seconds, voices) in CUES.items():
        write(os.path.join(target, name), seconds, voices)
        print(f"wrote {os.path.join(target, name)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
