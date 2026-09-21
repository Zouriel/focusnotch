#!/usr/bin/env python3
"""Minimal mpv JSON IPC client used by the focus notch.

Usage:
  mpvctl.py <socket> title            -> prints the current media title
  mpvctl.py <socket> get <property>   -> prints a property
  mpvctl.py <socket> set <prop> <val> -> sets a property
  mpvctl.py <socket> cycle pause      -> toggles pause
  mpvctl.py <socket> fade <seconds>   -> ramps volume to 0, then quits mpv
  mpvctl.py <socket> quit             -> quits mpv
"""
import json
import socket
import sys
import time


class Mpv:
    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(2.0)
        self.sock.connect(path)
        self.buf = b""

    def cmd(self, *args):
        self.sock.sendall(json.dumps({"command": list(args)}).encode() + b"\n")
        # mpv interleaves async events with replies; read until we see one
        deadline = time.time() + 2.0
        while time.time() < deadline:
            while b"\n" in self.buf:
                line, self.buf = self.buf.split(b"\n", 1)
                if not line.strip():
                    continue
                msg = json.loads(line)
                if "error" in msg:
                    return msg
            chunk = self.sock.recv(65536)
            if not chunk:
                break
            self.buf += chunk
        return {}


def main(argv):
    if len(argv) < 3:
        return 2
    path, action = argv[1], argv[2]
    try:
        m = Mpv(path)
    except OSError:
        return 1

    if action in ("title", "get"):
        prop = "media-title" if action == "title" else argv[3]
        r = m.cmd("get_property", prop)
        if r.get("error") == "success":
            print(r.get("data", ""))
        return 0
    if action == "set":
        m.cmd("set_property", argv[3], json.loads(argv[4]) if argv[4][:1] in "0123456789-tfn\"[{" else argv[4])
        return 0
    if action == "cycle":
        m.cmd("cycle", argv[3])
        return 0
    if action == "fade":
        secs = float(argv[3]) if len(argv) > 3 else 2.0
        r = m.cmd("get_property", "volume")
        start = r.get("data", 50) if r.get("error") == "success" else 50
        steps = max(1, int(secs / 0.06))
        for i in range(steps):
            m.cmd("set_property", "volume", start * (1 - (i + 1) / steps))
            time.sleep(secs / steps)
        m.cmd("quit")
        return 0
    if action == "quit":
        m.cmd("quit")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
