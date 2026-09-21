import QtQuick

// Round icon button, optionally with a label beside the glyph.
Rectangle {
    id: root

    required property string icon
    property string label: ""
    property bool primary: false
    property bool enabled: true

    signal clicked

    implicitWidth: root.label ? row.implicitWidth + Theme.px(20) : implicitHeight
    implicitHeight: Theme.px(28)
    radius: height / 2

    opacity: root.enabled ? 1 : 0.38
    color: root.primary ? Theme.accent : (hover.hovered ? Theme.chipBgHover : Theme.chipBg)

    Behavior on color {
        ColorAnimation {
            duration: 140
        }
    }

    Row {
        id: row

        anchors.centerIn: parent
        spacing: root.label ? Theme.px(5) : 0

        Text {
            anchors.verticalCenter: parent.verticalCenter
            text: root.icon
            color: root.primary ? Theme.onAccent : Theme.text
            font.family: Theme.fontIcon
            font.pixelSize: Theme.px(15)
        }

        Text {
            anchors.verticalCenter: parent.verticalCenter
            visible: !!root.label
            text: root.label
            color: root.primary ? Theme.onAccent : Theme.text
            font.family: Theme.fontBody
            font.pixelSize: Theme.px(12)
            font.weight: Font.Medium
        }
    }

    HoverHandler {
        id: hover

        enabled: root.enabled
        cursorShape: Qt.PointingHandCursor
    }

    TapHandler {
        enabled: root.enabled
        onTapped: root.clicked()
    }
}
