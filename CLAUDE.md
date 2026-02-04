# CLAUDE.md - Project Context for AI Assistance

## Project Overview

**GlaunchV2** is a GNOME Shell extension that provides keyboard-driven window management and application launching. It allows users to assign function keys (F1-F12) to launch/focus applications.

- **Technology**: TypeScript + GJS (GNOME JavaScript bindings)
- **Target**: GNOME Shell 46, 47, 48
- **UUID**: `glaunchv2@casta.dev`

## Recent Work Completed

### Settings Page Implementation (prefs.ts)

Created a new Adwaita-based preferences UI similar to GNOME's custom shortcuts settings:

- **File**: `prefs.ts`
- **Features**:
  - List view showing existing shortcuts (app name + function key)
  - "+" button to add new shortcuts
  - Dialog with:
    - Dropdown to select .desktop applications (scans /usr/share/applications, snap, flatpak, and user local apps)
    - Dropdown to select function key (F1-F12)
  - Delete button on each shortcut row
  - Duplicate key detection with error message
  - Shortcuts stored in GSettings as JSON
  - Window Management group with:
    - ComboRows for Previous Window, Cycle Other Windows, Close Window (F1-F12 + "None" to disable)
    - SwitchRow for "Center Mouse on Focus" toggle

### GSettings Schema Update

Modified `schemas/org.gnome.shell.extensions.glaunchv2.gschema.xml`:
- Added `shortcuts` key (string type) to store JSON array of shortcut configurations
- Format: `[{"app": "firefox.desktop", "key": "f9", "name": "Firefox"}, ...]`
- Added window management settings:
  - `win-prev-key` (string, default "f4") - empty to disable
  - `win-other-key` (string, default "f12") - empty to disable
  - `win-delete-key` (string, default "f3") - empty to disable
  - `win-center-mouse` (boolean, default true)

### Config Integration

Modified `config.ts` to read from GSettings instead of file (`~/.config/glaunchv2/glaunch.conf`):
- Constructor now accepts `Gio.Settings` parameter
- Parses shortcuts from GSettings JSON
- Converts to `ConfigEntry` format for the launcher
- Reads window management keys from GSettings (configurable via preferences UI):
  - `win-prev-key`: previous window (default F4, empty to disable)
  - `win-other-key`: cycle non-configured windows (default F12, empty to disable)
  - `win-delete-key`: close window (default F3, empty to disable)
  - `win-center-mouse`: center mouse on focus (default true)

### Extension.ts Update

Changed initialization order to create settings first, then pass to Config:
```typescript
this._settings = this.getSettings();
this._config = new Config(this._settings);
```

### Live Reload Implementation

Added automatic shortcut reloading when settings change (no GNOME Shell restart required):
- Connects to GSettings signals for all configurable keys in `enable()`:
  - `changed::shortcuts`
  - `changed::win-prev-key`
  - `changed::win-other-key`
  - `changed::win-delete-key`
  - `changed::win-center-mouse`
- `_reloadShortcuts()` method unbinds old keybindings and recreates Config/Launcher
- Signal handlers properly disconnected in `disable()`

## File Structure

```
glaunchv2/
├── extension.ts      # Main extension entry point
├── launcher.ts       # Keybinding management, window cycling
├── apps.ts           # Window/AppCollection classes
├── config.ts         # Reads shortcuts from GSettings (modified)
├── prefs.ts          # NEW: Settings UI with Adwaita
├── ambient.d.ts      # TypeScript declarations
├── metadata.json     # Extension metadata
├── tsconfig.json     # TypeScript config (includes prefs.ts)
├── schemas/
│   └── org.gnome.shell.extensions.glaunchv2.gschema.xml
└── Makefile          # Build/install scripts
```

## Build Commands

```bash
make all      # Compile TypeScript
make install  # Build and install to ~/.local/share/gnome-shell/extensions/
make clean    # Remove build artifacts
```

After install, restart GNOME Shell (log out/in on Wayland, Alt+F2 → `r` on X11).

## Potential Future Work

1. **Add modifier key support** - Allow Ctrl+F1, Alt+F2, etc.
2. **Edit existing shortcuts** - Currently can only add/delete, not edit
3. **Import/export settings** - Backup and restore configurations

## Key Interfaces

```typescript
// Stored in GSettings as JSON
interface ShortcutConfig {
  app: string;   // e.g., "firefox.desktop"
  key: string;   // e.g., "f9"
  name: string;  // e.g., "Firefox"
}

// Internal config format used by Launcher
interface ConfigEntry {
  act: string;   // "launch", "win_prev", "win_delete", "win_other", "win_center_mouse"
  key?: string;  // function key
  app?: string;  // app ID for "launch" action
}
```

## Notes

- The old config file (`~/.config/glaunchv2/glaunch.conf`) is no longer used
- Settings are accessed via GNOME Extensions app or `gnome-extensions prefs glaunchv2@casta.dev`
