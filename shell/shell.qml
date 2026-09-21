//@ pragma DefaultEnv QS_NO_RELOAD_POPUP=1
//@ pragma DefaultEnv QSG_RENDER_LOOP=threaded

import Quickshell

ShellRoot {
    Variants {
        model: Quickshell.screens

        Notch {}
    }

    Variants {
        model: Quickshell.screens

        BreakOverlay {}
    }
}
