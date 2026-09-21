#!/usr/bin/env python3
"""Stream the Hyprland cursor position to the focus notch.

The notch cannot use a layer-shell input region to detect the top screen edge:
owning those pixels is exactly what stops caelestia's dashboard from dropping
down. So we ask Hyprland where the cursor is instead, over its own IPC socket,
and print "x,y" whenever it moves.
"""
import os
import socket
import sys
import time


def sock_path():
    his = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
    if not his:
        return None
    rt = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    return f"{rt}/hypr/{his}/.socket.sock"


def query(path):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(1.0)
    try:
        s.connect(path)
        s.sendall(b"cursorpos")
        return s.recv(256).decode().strip()
    finally:
        s.close()


def main():
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 0.07
    path = sock_path()
    if not path:
        return 1

    last = None
    while True:
        try:
            pos = query(path)
        except OSError:
            time.sleep(0.5)
            continue
        if pos and pos != last:
            last = pos
            print(pos.replace(" ", ""), flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    sys.exit(main())
