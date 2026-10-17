# Glaunch

A GNOME Shell extension for keyboard-driven window management. Assign a function key to each app you use, and press it to launch, focus, or cycle through its windows.

## Why

Tiling window managers promise efficient screen usage but come with real costs: dozens of keybindings to memorize, conflicts with application shortcuts, and hours of configuration. Xah Lee makes a [compelling case against them](http://xahlee.info/linux/why_tiling_window_manager_sucks.html).

Glaunch takes a simpler approach. Instead of managing window layout, you assign one key per app. Press F9 to get to Firefox. Press F10 to get to your editor. If the app isn't running, it launches. If it is, it focuses. If it has multiple windows, it cycles through them. That's it.

No layout rules. No modifier key chains. No conflicts with your apps. Just direct access to your windows.

## How It Works

Each function key (F1-F12) maps to one application:

- **App not running** — launches it
- **App running, not focused** — focuses its most recent window
- **App running, already focused** — cycles to its next window

Additional keys handle window management:

- **Previous Window** — jump back to the last focused window (like Alt+Tab but instant)
- **Cycle Other Windows** — cycle through windows that don't have an assigned key
- **Close Window** — close the focused window

Optionally, the mouse cursor centers on the focused window after each switch, and after toggling its maximization with GNOME's "Toggle maximization state" shortcut.

## Installation

1. Clone and install:
   ```
   git clone https://github.com/lcasta7/Glaunch.git
   cd Glaunch
   make install
   ```

2. Log out and log back in to restart GNOME Shell

3. Enable the extension using the GNOME Extensions app

## Configuration

Open the preferences UI:

```
gnome-extensions prefs glaunch@casta.dev
```

### Shortcuts

Add a shortcut with **Add Shortcut…**: choose an app and a function key. Click a shortcut to change its app or key, or to remove it; a removal can be undone right after.

Each key can only be assigned once, across app shortcuts and window management keys. Keys that are already taken are shown with what they're assigned to, and shortcuts whose app is no longer installed are flagged.

### Window Management

- **Previous Window** — function key to jump to the last focused window (default: F4)
- **Cycle Other Windows** — function key to cycle windows without a shortcut (default: F12)
- **Close Window** — function key to close the focused window (default: F3)
- **Center Pointer on Focus** — move the pointer to the center of the window on switch, and after toggling its maximization (default: on)

All window management keys can be set to "None" to disable them.

## Recommended Layout

Think of the function keys in zones:

| Keys | Purpose |
|------|---------|
| F1-F4 | Window management |
| F5-F8 | App-specific shortcuts (set in each app) |
| F9-F11 | Your 3 most-used apps |
| F12 | Cycle all other windows |

### Window management (F1-F4)

| Key | Action |
|-----|--------|
| F1  | Toggle maximize (set via GNOME keyboard settings) |
| F2  | Screenshot (set via GNOME keyboard settings) |
| F3  | Close window |
| F4  | Switch to previous window |

### App launching (F9-F11)

| Key | App |
|-----|-----|
| F9  | Browser |
| F10 | Editor |
| F11 | Terminal |

### Other windows (F12)

F12 cycles through every window that doesn't have an assigned key. This covers apps you use occasionally without needing a dedicated binding.

### App-specific shortcuts (F5-F8)

F5-F8 are left unbound by Glaunch. Use them inside your apps for whatever you need — run/debug in your editor, refresh in your browser, etc. Since Glaunch doesn't claim these keys, there are no conflicts.

With this layout, switching between your browser and editor is just F9/F10. No hunting through Alt+Tab lists.

## Requirements

- GNOME Shell 50

## License

[GPL-2.0](LICENSE)
