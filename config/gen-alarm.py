#!/usr/bin/env python3
"""Generate a subtle two-note chime for the focus notch alarm."""
import math
import struct
import sys
import wave

RATE = 48000


def note(freq, dur, amp, start, buf):
    """Additive sine with a soft exponential decay, mixed into buf at `start` s."""
    n = int(dur * RATE)
    off = int(start * RATE)
    attack = int(0.008 * RATE)
    for i in range(n):
        t = i / RATE
        env = math.exp(-t * 2.6)
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


def main(path):
    total = int(3.2 * RATE)
    buf = [0.0] * total
    # E5 then C5: a gentle falling third, not an alert
    note(659.25, 2.2, 0.16, 0.00, buf)
    note(523.25, 2.6, 0.14, 0.42, buf)
    # soft octave shimmer underneath
    note(261.63, 2.8, 0.05, 0.42, buf)

    frames = bytearray()
    for v in buf:
        s = max(-1.0, min(1.0, v))
        frames += struct.pack("<hh", int(s * 32767), int(s * 32767))

    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "alarm.wav")
