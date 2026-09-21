pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io

// Colours, fonts and user options.
//
// Ships with a self-contained palette so the notch looks right on a bare
// system. If caelestia is installed its live scheme is used instead, so the
// notch retheres with the wallpaper; anything in config.json's "colours"
// overrides both.
Singleton {
    id: root

    readonly property string home: Quickshell.env("HOME")
    readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || `${root.home}/.local/state`
    readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || `${root.home}/.config`

    readonly property string cfgDir: `${root.configHome}/focusnotch`
    readonly property string stateDir: `${root.stateHome}/focusnotch`
    readonly property string caelScheme: `${root.stateHome}/caelestia/scheme.json`
    readonly property string caelConfig: `${root.configHome}/caelestia/shell.json`

    // Built-in fallback, a neutral blue-grey dark palette.
    readonly property var defaultColours: ({
            onSurface: "e3e2e5",
            onSurfaceVariant: "c3c6ce",
            outline: "8d9198",
            primary: "aac9f0",
            onPrimary: "0e3252",
            tertiary: "ecbf80",
            onTertiary: "442b00"
        })

    property var schemeColours: ({})
    property var opts: ({})

    function opt(key, fallback) {
        const v = root.opts[key];
        return v === undefined || v === null ? fallback : v;
    }

    // config.json wins, then caelestia's live scheme, then the built-in default.
    function col(key, fallback) {
        const over = (root.opts.colours ?? {})[key];
        if (over)
            return over.startsWith("#") ? over : `#${over}`;
        const v = root.schemeColours[key] ?? root.defaultColours[key];
        return v ? `#${v}` : fallback;
    }

    // The notch body reads as hardware, so it stays near-black rather than
    // picking up a translucent surface tint.
    readonly property color notchBg: root.col("notchBg", "#0a0b0d")
    readonly property color notchEdge: Qt.rgba(1, 1, 1, 0.07)
    readonly property color text: root.col("onSurface", "#e3e2e5")
    readonly property color subtext: root.col("onSurfaceVariant", "#c3c6ce")
    readonly property color faint: root.col("outline", "#8d9198")
    readonly property color accent: root.col("primary", "#aac9f0")
    readonly property color onAccent: root.col("onPrimary", "#0e3252")
    // Breaks get their own colour so work and rest never read the same.
    readonly property color breakColour: root.col("tertiary", "#ecbf80")
    readonly property color onBreakColour: root.col("onTertiary", "#442b00")
    readonly property color chipBg: Qt.rgba(1, 1, 1, 0.07)
    readonly property color chipBgHover: Qt.rgba(1, 1, 1, 0.13)

    // Fonts. "sans-serif"/"monospace" resolve through fontconfig everywhere;
    // the icon font is the one real asset dependency.
    property string fontClock: root.opt("fontClock", "sans-serif")
    property string fontBody: root.opt("fontBody", "sans-serif")
    property string fontIcon: root.opt("fontIcon", "Material Symbols Rounded")

    readonly property real scale: root.opt("scale", 1.0)

    function px(v) {
        return Math.round(v * root.scale);
    }

    // Optional: caelestia's live colour scheme.
    FileView {
        path: root.caelScheme
        printErrors: false
        watchChanges: true
        onFileChanged: reload()
        onLoaded: {
            try {
                root.schemeColours = JSON.parse(text()).colours ?? {};
            } catch (e) {
                console.warn("focusnotch: could not parse caelestia scheme.json:", e);
            }
        }
    }

    // Optional: caelestia's font choices, unless config.json set them.
    FileView {
        path: root.caelConfig
        printErrors: false
        watchChanges: true
        onFileChanged: reload()
        onLoaded: {
            try {
                const f = JSON.parse(text()).appearance?.font ?? {};
                if (root.opts.fontClock === undefined)
                    root.fontClock = f.clock ?? f.body?.family ?? root.fontClock;
                if (root.opts.fontBody === undefined)
                    root.fontBody = f.body?.family ?? root.fontBody;
                if (root.opts.fontIcon === undefined)
                    root.fontIcon = f.icon?.family ?? root.fontIcon;
            } catch (e) {
                console.warn("focusnotch: could not parse caelestia shell.json:", e);
            }
        }
    }

    FileView {
        path: `${root.cfgDir}/config.json`
        printErrors: false
        watchChanges: true
        onFileChanged: reload()
        onLoaded: {
            try {
                root.opts = JSON.parse(text());
            } catch (e) {
                console.warn("focusnotch: could not parse config.json:", e);
            }
        }
    }
}
