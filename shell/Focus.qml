pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io

// The focus session.
//
// A session is a plan: a list of work blocks with breaks between them. With
// breaks off the plan is a single work block, which is the old behaviour.
//
// The duration you pick is *focus* time, not elapsed time: 60 minutes means
// 60 minutes of work, and the breaks are added on top. So the chips keep
// meaning what they say.
Singleton {
    id: root

    property int minutes: 30
    property bool breaksEnabled: false

    property bool running: false
    property bool finished: false

    // The plan, and where we are in it.
    property var plan: [{
            kind: "work",
            secs: 1800
        }]
    property int phase: 0
    // Seconds left in the current phase. Derived from an absolute deadline
    // while running so it does not drift when the shell is busy.
    property int remaining: 1800
    property real deadline: 0

    readonly property var breakCfg: Theme.opt("breaks", {})
    readonly property int breakEvery: (root.breakCfg.everyMinutes ?? 20) * 60
    readonly property int breakLength: (root.breakCfg.lengthMinutes ?? 5) * 60
    readonly property int breakMinSession: (root.breakCfg.minSessionMinutes ?? 30) * 60

    // Whether breaks would apply to the currently selected duration.
    readonly property bool breaksApply: root.breaksEnabled && root.minutes * 60 >= root.breakMinSession && root.breakEvery > 0 && root.breakLength > 0

    readonly property var current: root.plan[root.phase] ?? ({
            kind: "work",
            secs: 0
        })
    readonly property bool onBreak: root.current.kind === "break"

    readonly property int workBlocks: root.plan.filter(p => p.kind === "work").length
    readonly property int workBlockIndex: root.plan.slice(0, root.phase + 1).filter(p => p.kind === "work").length

    readonly property int planTotal: root.plan.reduce((a, p) => a + p.secs, 0)
    readonly property int planElapsed: {
        let done = 0;
        for (let i = 0; i < root.phase; i++)
            done += root.plan[i].secs;
        return done + Math.max(0, root.current.secs - root.remaining);
    }

    readonly property bool active: root.running || root.phase > 0 || root.remaining < root.current.secs
    readonly property real progress: root.planTotal > 0 ? root.planElapsed / root.planTotal : 0

    function fmt(secs: int): string {
        const s = Math.max(0, secs);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        const p = n => String(n).padStart(2, "0");
        return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
    }

    // Split the chosen focus time into work blocks with breaks between them.
    // No break after the final block, and a stub final block gets folded into
    // the one before it rather than leaving you a two-minute sliver.
    function buildPlan(): var {
        const total = root.minutes * 60;
        if (!root.breaksApply)
            return [
                {
                    kind: "work",
                    secs: total
                }
            ];

        const blocks = [];
        let left = total;
        while (left > 0) {
            const c = Math.min(root.breakEvery, left);
            blocks.push(c);
            left -= c;
        }
        // A final sliver is worse than a slightly long last block: taking a
        // five minute break to then work five minutes is silly.
        if (blocks.length > 1 && blocks[blocks.length - 1] < root.breakEvery / 2)
            blocks[blocks.length - 2] += blocks.pop();

        const out = [];
        for (let i = 0; i < blocks.length; i++) {
            out.push({
                kind: "work",
                secs: blocks[i]
            });
            if (i < blocks.length - 1)
                out.push({
                    kind: "break",
                    secs: root.breakLength
                });
        }
        return out;
    }

    function rebuild(): void {
        root.plan = root.buildPlan();
        root.phase = 0;
        root.remaining = root.plan[0].secs;
        root.finished = false;
    }

    function start(): void {
        if (root.running)
            return;

        root.finished = false;
        if (root.remaining <= 0)
            root.remaining = root.current.secs;
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
        root.rebuild();
        Music.stop();
    }

    function setMinutes(m: int): void {
        root.minutes = m;
        const wasRunning = root.running;
        root.running = false;
        root.rebuild();
        if (wasRunning)
            root.start();
    }

    function setBreaks(on: bool): void {
        root.breaksEnabled = on;
        const wasRunning = root.running;
        root.running = false;
        root.rebuild();
        if (wasRunning)
            root.start();
    }

    // Move to the next phase, or finish if that was the last one.
    function advance(): void {
        if (root.phase + 1 >= root.plan.length) {
            root.complete();
            return;
        }

        root.phase += 1;
        root.remaining = root.current.secs;
        root.deadline = Date.now() + root.remaining * 1000;

        if (root.onBreak) {
            root.cue("break-start.wav");
            root.notify("Break time", `${Math.round(root.current.secs / 60)} minutes. Step away.`);
        } else {
            root.cue("break-end.wav");
            root.notify("Back to it", `Block ${root.workBlockIndex} of ${root.workBlocks}.`);
        }
    }

    // End a break early and get on with the next work block.
    function skip(): void {
        if (!root.onBreak)
            return;
        root.remaining = 0;
        root.advance();
        if (!root.running)
            root.start();
    }

    function dismiss(): void {
        root.finished = false;
        root.rebuild();
    }

    function complete(): void {
        root.running = false;
        root.remaining = 0;
        root.finished = true;
        root.cue("alarm.wav");
        root.notify("Focus session done", `${root.minutes} minute${root.minutes === 1 ? "" : "s"} of focus finished.`);
        Music.fadeStop();
        autoDismiss.restart();
    }

    // Uses play-alarm.sh, which picks whichever audio player the system has
    // (pipewire, pulse, ffplay, canberra, alsa, mpv). "alarmCommand" in
    // config.json overrides it outright; "{}" stands in for the sound file.
    function cue(name: string): void {
        const custom = Theme.opt("alarmCommand", []);
        const file = `${Theme.cfgDir}/${name}`;
        if (custom.length > 0)
            cueProc.exec(custom.map(a => a === "{}" ? file : a));
        else
            cueProc.exec(["sh", `${Theme.cfgDir}/play-alarm.sh`, file, String(Theme.opt("alarmVolume", 0.55))]);
    }

    // Desktop notification, if a notifier is installed. Absence is not an
    // error: the cue and the notch itself already say what happened.
    function notify(title: string, body: string): void {
        if (!Theme.opt("notify", true))
            return;
        notifyProc.exec(["sh", "-c", `command -v notify-send >/dev/null && notify-send -a Focus -u low "$1" "$2"`, "sh", title, body]);
    }

    Component.onCompleted: root.rebuild()

    // Rebuild if the break settings change under us while idle.
    onBreaksApplyChanged: {
        if (!root.active)
            root.rebuild();
    }

    Timer {
        running: root.running
        interval: 200
        repeat: true
        onTriggered: {
            const left = Math.ceil((root.deadline - Date.now()) / 1000);
            root.remaining = Math.max(0, left);
            if (left <= 0)
                root.advance();
        }
    }

    // Stop glowing at me eventually.
    Timer {
        id: autoDismiss

        interval: 60000
        onTriggered: root.dismiss()
    }

    Process {
        id: cueProc
    }

    Process {
        id: notifyProc
    }

    // Lets the timer be driven from keybinds or a terminal:
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

        function breaks(on: string): void {
            root.setBreaks(on === "toggle" ? !root.breaksEnabled : (on === "on" || on === "1" || on === "true"));
        }

        function skip(): void {
            root.skip();
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
                onBreak: root.onBreak,
                breaks: root.breaksEnabled,
                breaksApply: root.breaksApply,
                block: `${root.workBlockIndex}/${root.workBlocks}`,
                plan: root.plan.map(p => `${p.kind[0]}${Math.round(p.secs / 60)}`).join(" "),
                music: Music.enabled,
                musicPlaying: Music.playing,
                musicAvailable: Music.available,
                tracks: Music.tracks.length
            });
        }
    }

    Timer {
        id: saveDebounce

        interval: 400
        onTriggered: stateFile.setText(JSON.stringify({
            minutes: root.minutes,
            music: Music.enabled,
            breaks: root.breaksEnabled
        }))
    }

    Connections {
        target: root
        function onMinutesChanged(): void {
            saveDebounce.restart();
        }
        function onBreaksEnabledChanged(): void {
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
                if (d.minutes > 0)
                    root.minutes = d.minutes;
                Music.enabled = !!d.music;
                root.breaksEnabled = !!d.breaks;
                root.rebuild();
            } catch (e) {
                Qt.callLater(() => setText("{}"));
            }
        }
        onLoadFailed: {
            root.minutes = Theme.opt("defaultMinutes", 30);
            root.rebuild();
        }
    }
}
