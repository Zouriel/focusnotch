pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Wayland

// The break screen.
//
// A chime is easy to miss, and missing the start of a break defeats the point
// of having one. So a break takes over the screen: dimmed background, a large
// countdown, and no ambiguity about what just happened.
//
// It is a nudge, not a cage. Clicking anywhere dismisses it and the break
// carries on underneath; Skip ends the break outright.
PanelWindow {
    id: win

    required property ShellScreen modelData

    screen: win.modelData
    WlrLayershell.namespace: "focusnotch-break"
    WlrLayershell.layer: WlrLayer.Overlay
    // Cover the whole output, bars and all.
    WlrLayershell.exclusionMode: ExclusionMode.Ignore
    color: "transparent"
    exclusiveZone: 0

    anchors.top: true
    anchors.bottom: true
    anchors.left: true
    anchors.right: true

    readonly property var cfg: Theme.opt("breakOverlay", {})
    readonly property bool shown: Focus.showBreakScreen
    readonly property bool greeting: Focus.backToWork && !Focus.onBreak

    // Driven rather than bound so the fade-out is actually seen before the
    // surface goes away.
    property real anim: 0

    Behavior on anim {
        NumberAnimation {
            duration: 260
            easing.type: Easing.OutCubic
        }
    }

    onShownChanged: win.anim = win.shown ? 1 : 0
    Component.onCompleted: win.anim = win.shown ? 1 : 0

    visible: win.anim > 0.002

    Item {
        anchors.fill: parent
        opacity: win.anim

        // Dim everything behind. Also swallows the click that dismisses.
        Rectangle {
            anchors.fill: parent
            color: Qt.rgba(0, 0, 0, win.cfg.dimOpacity ?? 0.6)

            TapHandler {
                onTapped: Focus.dismissBreakScreen()
            }
        }

        Rectangle {
            id: card

            anchors.centerIn: parent
            width: Math.min(Theme.px(560), win.width * 0.8)
            implicitHeight: col.implicitHeight + Theme.px(56)
            radius: Theme.px(28)
            color: Theme.notchBg
            border.width: 1
            border.color: Qt.alpha(win.greeting ? Theme.accent : Theme.breakColour, 0.35)

            scale: 0.94 + 0.06 * win.anim

            // Clicks on the card itself must not dismiss it.
            TapHandler {}

            Column {
                id: col

                anchors.centerIn: parent
                width: parent.width - Theme.px(56)
                spacing: Theme.px(14)

                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: win.greeting ? "resume" : "local_cafe"
                    color: win.greeting ? Theme.accent : Theme.breakColour
                    font.family: Theme.fontIcon
                    font.pixelSize: Theme.px(52)
                }

                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: win.greeting ? "Back to it" : "Break time"
                    color: Theme.text
                    font.family: Theme.fontClock
                    font.pixelSize: Theme.px(30)
                    font.weight: Font.DemiBold
                }

                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    text: {
                        if (win.greeting) {
                            const mins = Math.round(Focus.current.secs / 60);
                            return `Block ${Focus.workBlockIndex} of ${Focus.workBlocks} · ${mins} minute${mins === 1 ? "" : "s"}`;
                        }
                        if (Focus.previewing)
                            return "This is what a break looks like.";
                        return `Block ${Focus.workBlockIndex} of ${Focus.workBlocks} done. Step away from the screen.`;
                    }
                    color: Theme.subtext
                    font.family: Theme.fontBody
                    font.pixelSize: Theme.px(14)
                }

                Item {
                    width: 1
                    height: Theme.px(4)
                }

                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    visible: !win.greeting
                    text: Focus.previewing ? "05:00" : Focus.fmt(Focus.remaining)
                    color: Theme.breakColour
                    font.family: Theme.fontClock
                    font.pixelSize: Theme.px(72)
                    font.weight: Font.Light
                }

                // How much of the break is left, at a glance.
                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    visible: !win.greeting
                    width: parent.width * 0.7
                    height: Theme.px(3)
                    radius: height / 2
                    color: Qt.alpha(Theme.faint, 0.25)

                    Rectangle {
                        width: parent.width * (Focus.previewing || Focus.current.secs <= 0 ? 1 : Focus.remaining / Focus.current.secs)
                        height: parent.height
                        radius: height / 2
                        color: Theme.breakColour

                        Behavior on width {
                            NumberAnimation {
                                duration: 400
                                easing.type: Easing.OutCubic
                            }
                        }
                    }
                }

                Item {
                    width: 1
                    height: Theme.px(8)
                }

                Row {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: Theme.px(10)

                    OverlayButton {
                        visible: !win.greeting && !Focus.previewing
                        icon: "skip_next"
                        label: "Skip break"
                        onClicked: Focus.skip()
                    }

                    OverlayButton {
                        icon: "close"
                        label: win.greeting ? "Got it" : "Dismiss"
                        primary: true
                        onClicked: Focus.dismissBreakScreen()
                    }
                }

                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "click anywhere to dismiss"
                    color: Qt.alpha(Theme.faint, 0.7)
                    font.family: Theme.fontBody
                    font.pixelSize: Theme.px(10)
                }
            }
        }
    }

    component OverlayButton: Rectangle {
        id: btn

        required property string icon
        required property string label
        property bool primary: false
        // Amber on a break, accent on the back-to-work card, so the button
        // never fights the rest of the card.
        readonly property color tint: win.greeting ? Theme.accent : Theme.breakColour
        readonly property color onTint: win.greeting ? Theme.onAccent : Theme.onBreakColour

        signal clicked

        implicitWidth: btnRow.implicitWidth + Theme.px(30)
        implicitHeight: Theme.px(40)
        radius: height / 2
        color: btn.primary ? btn.tint : (btnHover.hovered ? Theme.chipBgHover : Theme.chipBg)

        Behavior on color {
            ColorAnimation {
                duration: 140
            }
        }

        Row {
            id: btnRow

            anchors.centerIn: parent
            spacing: Theme.px(7)

            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: btn.icon
                color: btn.primary ? btn.onTint : Theme.text
                font.family: Theme.fontIcon
                font.pixelSize: Theme.px(18)
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: btn.label
                color: btn.primary ? btn.onTint : Theme.text
                font.family: Theme.fontBody
                font.pixelSize: Theme.px(14)
                font.weight: Font.Medium
            }
        }

        HoverHandler {
            id: btnHover

            cursorShape: Qt.PointingHandCursor
        }

        TapHandler {
            onTapped: btn.clicked()
        }
    }
}
