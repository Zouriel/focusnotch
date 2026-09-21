import QtQuick

// A duration pill (5 / 10 / 15 / 30 / 60 / 90).
Rectangle {
    id: root

    required property int minutes
    property bool selected: false

    signal picked

    implicitWidth: Math.max(Theme.px(30), label.implicitWidth + Theme.px(14))
    implicitHeight: Theme.px(24)
    radius: height / 2

    color: root.selected ? Theme.accent : (hover.hovered ? Theme.chipBgHover : Theme.chipBg)

    Behavior on color {
        ColorAnimation {
            duration: 140
        }
    }

    Text {
        id: label

        anchors.centerIn: parent
        text: root.minutes
        color: root.selected ? Theme.onAccent : Theme.subtext
        font.family: Theme.fontBody
        font.pixelSize: Theme.px(12)
        font.weight: root.selected ? Font.DemiBold : Font.Medium

        Behavior on color {
            ColorAnimation {
                duration: 140
            }
        }
    }

    HoverHandler {
        id: hover

        cursorShape: Qt.PointingHandCursor
    }

    TapHandler {
        onTapped: root.picked()
    }
}
