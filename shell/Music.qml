pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io

// Background focus music: mpv in audio-only mode over the YouTube links in
// ~/.config/focusnotch/music.txt, controlled through mpv's JSON IPC socket.
Singleton {
    id: root

    readonly property string sock: `${Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"}/focusnotch-mpv.sock`
    readonly property string ctl: `${Theme.cfgDir}/mpvctl.py`

    // Is mpv installed at all
    property bool available: false
    // User's checkbox
    property bool enabled: false
    property list<var> tracks: []
    property string title: ""
    property bool paused: false

    readonly property bool playing: mpv.running
    readonly property bool usable: root.available && root.tracks.length > 0

    // Opens music.txt in whatever handles text/plain, unless config.json
    // names an explicit command (use "{}" as the placeholder for the path).
    function editPlaylist(): void {
        const custom = Theme.opt("editorCommand", []);
        const path = `${Theme.cfgDir}/music.txt`;
        if (custom.length > 0)
            editProc.exec(custom.map(a => a === "{}" ? path : a));
        else
            editProc.exec(["xdg-open", path]);
    }

    function start(): void {
        if (!root.usable || mpv.running)
            return;
        root.title = "";
        root.paused = false;
        mpv.running = true;
    }

    function setPaused(p: bool): void {
        if (!mpv.running)
            return;
        root.paused = p;
        ctlProc.exec([root.ctl, root.sock, "set", "pause", p ? "true" : "false"]);
    }

    // Used on a hard stop (reset / music unticked): kill it immediately.
    function stop(): void {
        root.paused = false;
        mpv.running = false;
        root.title = "";
    }

    // Used when the timer completes: ramp down so it does not cut off mid-note.
    function fadeStop(): void {
        if (!mpv.running) {
            root.stop();
            return;
        }
        fadeProc.exec([root.ctl, root.sock, "fade", "2.5"]);
        fadeGuard.restart();
    }

    Process {
        id: probe

        running: true
        command: ["sh", "-c", "command -v mpv >/dev/null && command -v yt-dlp >/dev/null && echo yes"]
        stdout: StdioCollector {
            onStreamFinished: root.available = text.trim() === "yes"
        }
    }

    // Re-probe periodically so installing mpv later starts working on its own,
    // rather than needing the shell restarted. The check is a shell builtin
    // lookup, so it costs nothing worth measuring.
    Timer {
        running: true
        interval: 60000
        repeat: true
        onTriggered: {
            if (!probe.running)
                probe.running = true;
        }
    }

    Process {
        id: mpv

        command: [
            "mpv",
            "--no-video",
            "--no-terminal",
            "--idle=no",
            "--shuffle",
            "--loop-playlist=inf",
            "--ytdl-format=bestaudio/best",
            `--volume=${Theme.opt("musicVolume", 45)}`,
            `--input-ipc-server=${root.sock}`,
            ...root.tracks.map(t => t.url)
        ]
        onExited: {
            root.title = "";
            root.paused = false;
        }
    }

    Process {
        id: ctlProc
    }

    Process {
        id: editProc
    }

    Process {
        id: fadeProc
    }

    // If the fade helper cannot reach mpv, do not leave it playing forever.
    Timer {
        id: fadeGuard

        interval: 4000
        onTriggered: root.stop()
    }

    Process {
        id: titleProc

        command: [root.ctl, root.sock, "title"]
        stdout: StdioCollector {
            onStreamFinished: {
                const t = text.trim();
                if (t)
                    root.title = t;
            }
        }
    }

    Timer {
        running: mpv.running
        interval: 4000
        repeat: true
        triggeredOnStart: true
        onTriggered: {
            if (!titleProc.running)
                titleProc.running = true;
        }
    }

    FileView {
        path: `${Theme.cfgDir}/music.txt`
        printErrors: false
        watchChanges: true
        onFileChanged: reload()
        onLoaded: {
            const out = [];
            for (const raw of text().split("\n")) {
                const line = raw.trim();
                if (!line || line.startsWith("#"))
                    continue;

                const bar = line.indexOf("|");
                const url = (bar === -1 ? line : line.slice(0, bar)).trim();
                const label = bar === -1 ? "" : line.slice(bar + 1).trim();
                if (!url.startsWith("http"))
                    continue;

                out.push({
                    url: url,
                    label: label || url.replace(/^https?:\/\/(www\.)?/, "")
                });
            }
            root.tracks = out;
        }
    }
}
