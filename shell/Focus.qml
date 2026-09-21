pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io

// The focus session itself: countdown, the subtle chime, and persistence of the
// two things worth remembering across restarts (duration + music tick).
Singleton {
    id: root

    property int minutes: 30
    property bool running: false
    property bool finished: false
    // Seconds left. Derived from an absolute deadline while running so it does
    // not drift when the shell is busy.
    property int remaining: root.minutes * 60
    property real deadline: 0

    readonly property int total: root.minutes * 60
    readonly property bool active: root.running || root.remaining < root.total
    readonly property real progress: root.total > 0 ? 1 - root.remaining / root.total : 0

    function fmt(secs: int): string {
        const s = Math.max(0, secs);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        const p = n => String(n).padStart(2, "0");
        return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
    }

    function start(): void {
        if (root.running)
            return;

        root.finished = false;
        if (root.remaining <= 0)
            root.remaining = root.total;
        root.deadline = Date.now() + root.remaining * 1000;
        root.running = true;

        if (Music.enabled) {
            if (Music.playing)
                Music.setPaused(false);
            else
                Music.start();
        }
    }

    function pause(): void {
        if (!root.running)
            return;

        root.remaining = Math.max(0, Math.ceil((root.deadline - Date.now()) / 1000));
        root.running = false;
        if (Music.playing)
            Music.setPaused(true);
    }

    function toggle(): void {
        if (root.running)
            root.pause();
        else
            root.start();
    }

    function reset(): void {
        root.running = false;
        root.finished = false;
        root.remaining = root.total;
        Music.stop();
    }

    function setMinutes(m: int): void {
        root.minutes = m;
        root.finished = false;
        if (!root.running)
            root.remaining = m * 60;
        else
            // Retarget a running session onto the new length.
            root.deadline = Date.now() + m * 60 * 1000;
    }

    function dismiss(): void {
        root.finished = false;
        root.remaining = root.total;
    }

    function complete(): void {
        root.running = false;
        root.remaining = 0;
        root.finished = true;
        root.chime();
        root.notify();
        Music.fadeStop();
        autoDismiss.restart();
    }

    // Uses play-alarm.sh, which picks whichever audio player the system has
    // (pipewire, pulse, ffplay, canberra, alsa, mpv). "alarmCommand" in
    // config.json overrides it outright; "{}" stands in for the sound file.
    function chime(): void {
        const custom = Theme.opt("alarmCommand", []);
        const file = `${Theme.cfgDir}/alarm.wav`;
        if (custom.length > 0)
            chimeProc.exec(custom.map(a => a === "{}" ? file : a));
        else
            chimeProc.exec(["sh", `${Theme.cfgDir}/play-alarm.sh`, file, String(Theme.opt("alarmVolume", 0.55))]);
    }

    // Lets the timer be driven from Hyprland keybinds or a terminal:
    //   qs -c focusnotch ipc call focus toggle
    IpcHandler {
        target: "focus"

        function toggle(): void {
            root.toggle();
        }

        function start(): void {
            root.start();
        }

        function pause(): void {
            root.pause();
        }

        function reset(): void {
            root.reset();
        }

        function set(minutes: int): void {
            if (minutes > 0)
                root.setMinutes(minutes);
        }

        function music(on: string): void {
            Music.enabled = on === "toggle" ? !Music.enabled : (on === "on" || on === "1" || on === "true");
        }

        function status(): string {
            return JSON.stringify({
                minutes: root.minutes,
                remaining: root.remaining,
                running: root.running,
                finished: root.finished,
                music: Music.enabled,
                musicPlaying: Music.playing,
                musicAvailable: Music.available,
                tracks: Music.tracks.length
            });
        }
    }

    Timer {
        running: root.running
        interval: 200
        repeat: true
        onTriggered: {
            const left = Math.ceil((root.deadline - Date.now()) / 1000);
            root.remaining = Math.max(0, left);
            if (left <= 0)
                root.complete();
        }
    }

    // Stop glowing at me eventually.
    Timer {
        id: autoDismiss

        interval: 60000
        onTriggered: root.dismiss()
    }

    // Desktop notification, if a notifier is installed. Absence is not an
    // error: the chime and the glowing notch already say the session is over.
    function notify(): void {
        if (!Theme.opt("notify", true))
            return;
        const body = `${root.minutes} minute${root.minutes === 1 ? "" : "s"} of focus finished.`;
        notifyProc.exec(["sh", "-c", `command -v notify-send >/dev/null && notify-send -a Focus -u low "Focus session done" "$1"`, "sh", body]);
    }

    Process {
        id: chimeProc
    }

    Process {
        id: notifyProc
    }

    Timer {
        id: saveDebounce

        interval: 400
        onTriggered: stateFile.setText(JSON.stringify({
            minutes: root.minutes,
            music: Music.enabled
        }))
    }

    Connections {
        target: root
        function onMinutesChanged(): void {
            saveDebounce.restart();
        }
    }

    Connections {
        target: Music

        // Ticking the box mid-session should take effect straight away, not
        // wait for the next Start.
        function onEnabledChanged(): void {
            saveDebounce.restart();

            if (!Music.enabled)
                Music.stop();
            else if (root.running && !Music.playing)
                Music.start();
        }
    }

    FileView {
        id: stateFile

        path: `${Theme.stateDir}/state.json`
        printErrors: false
        onLoaded: {
            try {
                const d = JSON.parse(text());
                if (d.minutes > 0) {
                    root.minutes = d.minutes;
                    root.remaining = d.minutes * 60;
                }
                Music.enabled = !!d.music;
            } catch (e) {
                Qt.callLater(() => setText("{}"));
            }
        }
        onLoadFailed: {
            root.minutes = Theme.opt("defaultMinutes", 30);
            root.remaining = root.minutes * 60;
        }
    }
}
