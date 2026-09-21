pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland

// A MacBook-style notch pinned to the top edge: square where it meets the
// bezel, rounded underneath. Hover the body for the controls; put the cursor
// in the absolute top edge and it gets out of the way.
PanelWindow {
    id: win

    required property ShellScreen modelData

    screen: win.modelData
    WlrLayershell.namespace: "focusnotch"
    WlrLayershell.layer: WlrLayer.Overlay
    // Ignore other layers' exclusive zones (a bar may reserve a pixel or two
    // at the top) so we sit flush with the bezel and own the y == 0 row.
    WlrLayershell.exclusionMode: ExclusionMode.Ignore
    color: "transparent"

    // Never reserve space: windows tile underneath, exactly like the real thing.
    exclusiveZone: 0
    anchors.top: true

    // ---------------------------------------------------------------- state

    property bool hidden: false
    readonly property bool open: bodyHover.hovered && !win.hidden

    readonly property int corner: Theme.px(20)
    readonly property int pad: Theme.px(14)
    readonly property int triggerBand: Math.max(2, Theme.opt("topTriggerPx", 3))

    readonly property int collapsedW: Math.max(Theme.px(Theme.opt("minWidth", 250)), topRow.implicitWidth + win.pad * 2)
    readonly property int collapsedH: Theme.px(34)
    readonly property int expandedW: Math.max(win.collapsedW, controls.implicitWidth + win.pad * 2)
    readonly property int expandedH: win.collapsedH + controls.implicitHeight + Theme.px(12)

    readonly property int spanLeft: (win.screen.width - win.collapsedW) / 2
    readonly property int spanRight: win.spanLeft + win.collapsedW

    // Compositor-agnostic: wlr-foreign-toplevel, not a Hyprland-specific call.
    readonly property bool fullscreen: Theme.opt("hideOnFullscreen", true) && (ToplevelManager.activeToplevel?.fullscreen ?? false)

    // -------------------------------------------------------- edge detection
    //
    // Two ways to notice the cursor reaching the top edge:
    //
    //   "hover"   - claim the top few pixels as our own input region. Works on
    //               any compositor, needs nothing installed. But owning those
    //               pixels stops any other panel that uses the same band as a
    //               hover trigger (caelestia's dashboard, for one).
    //
    //   "pointer" - claim nothing, and read the cursor from the compositor
    //               instead. Leaves the top edge free for other panels.
    //               Needs Hyprland, whose IPC can report the cursor position.
    //
    // "auto" picks pointer under Hyprland and hover everywhere else.
    readonly property bool onHyprland: !!Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE")
    readonly property string edgeMode: {
        const m = Theme.opt("edgeMode", "auto");
        if (m === "pointer" || m === "hover")
            return m;
        return win.onHyprland ? "pointer" : "hover";
    }
    readonly property bool pointerMode: win.edgeMode === "pointer"

    // Cursor in screen-local coordinates (pointer mode only).
    property int cx: -1
    property int cy: -1

    readonly property bool inTopBand: win.pointerMode && win.cy >= 0 && win.cy <= win.triggerBand
    readonly property bool inTrigger: win.inTopBand && win.cx >= win.spanLeft && win.cx <= win.spanRight

    // Whether another panel currently owns the top of the screen. Asked
    // directly rather than guessed, so "reappear when it goes" is exact.
    property bool ownerOpen: false
    property bool ownerAvailable: false

    readonly property var ownerCommand: {
        const o = Theme.opt("topEdgeOwner", "auto");
        if (Array.isArray(o))
            return o;
        if (o === "auto")
            return ["qs", "-c", "caelestia", "ipc", "call", "drawers", "isOpen", "dashboard"];
        return [];
    }

    function updateHidden(): void {
        if (win.inTrigger || win.ownerOpen) {
            reveal.stop();
            win.hidden = true;
        } else if (win.hidden) {
            reveal.restart();
        }
    }

    onInTriggerChanged: win.updateHidden()
    onOwnerOpenChanged: win.updateHidden()

    implicitWidth: win.open ? win.expandedW : win.collapsedW
    implicitHeight: win.open ? win.expandedH : win.collapsedH

    Behavior on implicitWidth {
        NumberAnimation {
            duration: 300
            easing.type: Easing.OutQuint
        }
    }

    Behavior on implicitHeight {
        NumberAnimation {
            duration: 300
            easing.type: Easing.OutQuint
        }
    }

    // Input region. In pointer mode we never claim the top band (that is the
    // whole point) and claim nothing at all while hidden. In hover mode we
    // need the band, and keep just that sliver alive while hidden so we can
    // tell when the cursor leaves again.
    mask: win.hidden ? (win.pointerMode ? emptyRegion : stripRegion) : bodyRegion

    Region {
        id: emptyRegion
    }

    Region {
        id: stripRegion

        item: topStrip
    }

    Region {
        id: bodyRegion

        x: 0
        y: win.pointerMode ? win.triggerBand : 0
        width: win.width
        height: Math.max(0, win.height - (win.pointerMode ? win.triggerBand : 0))
    }

    Timer {
        id: reveal

        interval: Theme.opt("revealDelayMs", 150)
        onTriggered: win.hidden = false
    }

    // Pointer mode: stream the cursor from the compositor.
    Process {
        running: win.pointerMode
        command: [`${Theme.cfgDir}/cursor-watch.py`, String(Theme.opt("cursorPollSeconds", 0.07))]
        stdout: SplitParser {
            onRead: data => {
                const parts = data.split(",");
                if (parts.length !== 2)
                    return;
                win.cx = parseInt(parts[0]) - win.screen.x;
                win.cy = parseInt(parts[1]) - win.screen.y;
            }
        }
    }

    // One-shot probe: is there anything to coexist with at all?
    Process {
        running: win.ownerCommand.length > 0
        command: win.ownerCommand
        stdout: StdioCollector {
            onStreamFinished: win.ownerAvailable = ["0", "1"].includes(text.trim())
        }
    }

    Process {
        id: ownerPoll

        command: win.ownerCommand
        stdout: StdioCollector {
            onStreamFinished: win.ownerOpen = text.trim() === "1"
        }
    }

    // The probe costs a process spawn, so this deliberately does not run at
    // idle: only while the cursor is in the top band, or while we are already
    // out of the way waiting for the other panel to close.
    Timer {
        running: win.ownerAvailable && (win.hidden || win.inTopBand || Theme.opt("alwaysWatchTopEdge", false))
        interval: Theme.opt("topEdgeOwnerPollMs", 150)
        repeat: true
        triggeredOnStart: true
        onTriggered: {
            if (!ownerPoll.running)
                ownerPoll.running = true;
        }
        onRunningChanged: {
            // Do not let a stale "open" keep the notch hidden forever.
            if (!running)
                win.ownerOpen = false;
        }
    }

    // ------------------------------------------------------------------ view

    // Always fills the window and never moves, so in hover mode it keeps
    // reporting the cursor even while the notch itself is tucked away.
    Item {
        id: body

        anchors.fill: parent
        clip: true

        HoverHandler {
            id: bodyHover
        }

        // Hover mode's gesture zone. Topmost so it wins hover delivery over
        // the content below. Inert in pointer mode.
        Item {
            id: topStrip

            x: 0
            y: 0
            z: 10
            width: body.width
            height: win.triggerBand

            HoverHandler {
                enabled: !win.pointerMode
                onHoveredChanged: {
                    if (win.pointerMode)
                        return;
                    if (hovered) {
                        reveal.stop();
                        win.hidden = true;
                    } else {
                        reveal.restart();
                    }
                }
            }
        }

        Item {
            id: content

            width: body.width
            height: body.height

            y: win.hidden || win.fullscreen ? -height : 0
            opacity: win.hidden || win.fullscreen ? 0 : 1

            Behavior on y {
                NumberAnimation {
                    duration: 260
                    easing.type: Easing.OutQuint
                }
            }

            Behavior on opacity {
                NumberAnimation {
                    duration: 200
                }
            }

            // Shifted up by exactly its own radius so the top corners are
            // clipped away: flush with the bezel above, rounded below.
            Rectangle {
                id: shellRect

                x: 0
                y: -win.corner
                width: parent.width
                height: parent.height + win.corner
                radius: win.corner
                color: Theme.notchBg
                border.width: 1
                border.color: Focus.finished ? Theme.accent : Theme.notchEdge

                Behavior on border.color {
                    ColorAnimation {
                        duration: 400
                    }
                }

                // Soft pulse when the session lands, instead of a flashing banner.
                SequentialAnimation on opacity {
                    running: Focus.finished
                    loops: Animation.Infinite
                    alwaysRunToEnd: true

                    NumberAnimation {
                        to: 0.72
                        duration: 900
                        easing.type: Easing.InOutSine
                    }

                    NumberAnimation {
                        to: 1
                        duration: 900
                        easing.type: Easing.InOutSine
                    }
                }
            }

            // ---- persistent top row: clock, and the countdown once armed ----
            Row {
                id: topRow

                y: (win.collapsedH - height) / 2
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: Theme.px(8)

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: Qt.formatDateTime(clock.date, Theme.opt("showSeconds", false) ? "HH:mm:ss" : "HH:mm")
                    color: Theme.text
                    font.family: Theme.fontClock
                    font.pixelSize: Theme.px(15)
                    font.weight: Font.Medium
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: Focus.active || Focus.finished
                    text: "·"
                    color: Theme.faint
                    font.family: Theme.fontBody
                    font.pixelSize: Theme.px(15)
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: Focus.active || Focus.finished
                    text: Focus.finished ? "timer_off" : (Focus.running ? "hourglass_bottom" : "pause")
                    color: Theme.accent
                    font.family: Theme.fontIcon
                    font.pixelSize: Theme.px(14)
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: Focus.active || Focus.finished
                    text: Focus.finished ? "done" : Focus.fmt(Focus.remaining)
                    color: Theme.accent
                    font.family: Theme.fontClock
                    font.pixelSize: Theme.px(15)
                    font.weight: Font.Medium
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: Music.playing && !Music.paused
                    text: "music_note"
                    color: Theme.faint
                    font.family: Theme.fontIcon
                    font.pixelSize: Theme.px(13)
                }
            }

            // ---- the panel that appears on hover ----
            Column {
                id: controls

                anchors.horizontalCenter: parent.horizontalCenter
                y: win.collapsedH - Theme.px(2)
                spacing: Theme.px(8)

                opacity: win.open ? 1 : 0
                visible: opacity > 0.01

                Behavior on opacity {
                    NumberAnimation {
                        duration: 180
                    }
                }

                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: Qt.formatDateTime(clock.date, "dddd d MMMM")
                    color: Theme.faint
                    font.family: Theme.fontBody
                    font.pixelSize: Theme.px(11)
                }

                Row {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: Theme.px(6)

                    Repeater {
                        model: Theme.opt("presets", [5, 10, 15, 30, 60, 90])

                        Chip {
                            required property int modelData

                            minutes: modelData
                            selected: Focus.minutes === modelData
                            onPicked: Focus.setMinutes(modelData)
                        }
                    }
                }

                Row {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: Theme.px(6)

                    IconButton {
                        icon: Focus.running ? "pause" : "play_arrow"
                        label: Focus.running ? "Pause" : (Focus.active ? "Resume" : "Start")
                        primary: !Focus.running
                        onClicked: {
                            if (Focus.finished)
                                Focus.dismiss();
                            Focus.toggle();
                        }
                    }

                    IconButton {
                        icon: "replay"
                        enabled: Focus.active || Focus.finished
                        onClicked: Focus.reset()
                    }

                    // Music tick. Disabled with a hint when mpv/yt-dlp or the
                    // playlist are missing, rather than silently doing nothing.
                    Rectangle {
                        id: musicToggle

                        readonly property bool ok: Music.usable

                        implicitWidth: musicRow.implicitWidth + Theme.px(18)
                        implicitHeight: Theme.px(28)
                        radius: height / 2
                        opacity: musicToggle.ok ? 1 : 0.4
                        color: Music.enabled && musicToggle.ok ? Qt.alpha(Theme.accent, 0.22) : (musicHover.hovered ? Theme.chipBgHover : Theme.chipBg)

                        Behavior on color {
                            ColorAnimation {
                                duration: 140
                            }
                        }

                        Row {
                            id: musicRow

                            anchors.centerIn: parent
                            spacing: Theme.px(5)

                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: Music.enabled && musicToggle.ok ? "check_box" : "check_box_outline_blank"
                                color: Music.enabled && musicToggle.ok ? Theme.accent : Theme.subtext
                                font.family: Theme.fontIcon
                                font.pixelSize: Theme.px(15)
                            }

                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: {
                                    if (!Music.available)
                                        return "Music (install mpv + yt-dlp)";
                                    if (Music.tracks.length === 0)
                                        return "Music (add links)";
                                    if (Music.playing && Music.title)
                                        return Music.title.length > 34 ? Music.title.slice(0, 33) + "…" : Music.title;
                                    return `Music · ${Music.tracks.length}`;
                                }
                                color: Theme.text
                                font.family: Theme.fontBody
                                font.pixelSize: Theme.px(11)
                                font.weight: Font.Medium
                            }
                        }

                        HoverHandler {
                            id: musicHover

                            enabled: musicToggle.ok
                            cursorShape: Qt.PointingHandCursor
                        }

                        TapHandler {
                            enabled: musicToggle.ok
                            onTapped: Music.enabled = !Music.enabled
                        }
                    }

                    // Opens music.txt so the link list can be edited in
                    // place. Always enabled: it is how you fix an empty
                    // playlist.
                    IconButton {
                        icon: "edit_note"
                        onClicked: Music.editPlaylist()
                    }
                }
            }

            // ---- progress hairline along the bottom edge ----
            Item {
                width: parent.width - win.corner * 2
                x: win.corner
                height: Theme.px(2)
                y: parent.height - height - Theme.px(3)
                visible: Focus.active && !Focus.finished

                Rectangle {
                    anchors.fill: parent
                    radius: height / 2
                    color: Qt.alpha(Theme.faint, 0.25)
                }

                Rectangle {
                    width: parent.width * Math.min(1, Math.max(0, Focus.progress))
                    height: parent.height
                    radius: height / 2
                    color: Theme.accent

                    Behavior on width {
                        NumberAnimation {
                            duration: 300
                            easing.type: Easing.OutCubic
                        }
                    }
                }
            }
        }
    }

    // Observability: qs -c focusnotch ipc call notch state
    IpcHandler {
        target: "notch"
        enabled: win.modelData === Quickshell.screens[0]

        function state(): string {
            return JSON.stringify({
                hidden: win.hidden,
                open: win.open,
                edgeMode: win.edgeMode,
                cursor: [win.cx, win.cy],
                inTrigger: win.inTrigger,
                topEdgeOwner: win.ownerAvailable ? (win.ownerOpen ? "open" : "closed") : "none",
                span: [win.spanLeft, win.spanRight],
                fullscreen: win.fullscreen
            });
        }
    }

    SystemClock {
        id: clock

        precision: Theme.opt("showSeconds", false) ? SystemClock.Seconds : SystemClock.Minutes
    }
}
