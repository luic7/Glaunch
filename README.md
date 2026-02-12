# Glaunch

A GNOME Shell extension for keyboard-driven window management and application launching with TypeScript.

## Overview

Glaunch allows you to:

- Launch applications with customizable keyboard shortcuts
- Quickly navigate between windows of the same application
- Switch to previously used windows
- Delete windows with keyboard shortcuts
- Auto-center the mouse pointer when switching between windows

## Features

- **Application Launching**: Bind keys to launch your favorite applications
- **Window Cycling**: Quickly cycle through windows of the same application
- **Window Management**: Navigate and delete windows without touching the mouse
- **Mouse Centering**: Automatically centers the mouse pointer when focusing windows
- **Simple Configuration**: Easy-to-edit configuration file

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/lcasta7/Glaunch.git
   ```

2. Install the extension:
   ```
   cd glaunch
   make install
   ```

3. Restart GNOME Shell:
   - Press Alt+F2, type 'r', press Enter (X11)
   - Log out and log back in (Wayland)

4. Enable the extension using GNOME Extensions app or gnome-extensions-app

## Configuration

Glaunch is configured via the GNOME Extensions preferences UI. Open it with:

```
gnome-extensions prefs glaunch@casta.dev
```

### Settings

- **Custom Shortcuts**: Assign function keys (F1-F12) to launch applications
- **Previous Window**: Key to switch to the previously focused window
- **Cycle Other Windows**: Key to cycle through non-configured application windows
- **Close Window**: Key to close the currently focused window
- **Center Mouse on Focus**: Toggle to center mouse cursor when focusing windows

## Usage

- Press the configured keys to launch applications
- When an application is already running, pressing its key will focus it
- If multiple windows of the same application are open, repeatedly pressing the key will cycle through them
- Use the win_prev key to switch to the previous window
- Use the win_delete key to close the focused window
- Use the win_other key to cycle through windows of non-configured applications

## How It Works

Glaunch maintains collections of application windows grouped by their desktop names. When you press a shortcut key associated with an application:

1. If the application is not running, it launches the application
2. If the application is running with one window, it focuses that window
3. If the application has multiple windows, it cycles through them

Additionally, the extension automatically centers the mouse pointer when switching between windows, making it easier to interact with the newly focused window.

## Requirements

- GNOME Shell 46 or later
- TypeScript

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Original Glaunch extension by lcasta7
