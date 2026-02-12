import Gio from "gi://Gio";
import Meta from "gi://Meta";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import Config from "./config.js";
import Launcher from "./launcher.js";

export default class Glaunch extends Extension {
	private _config: Config | null = null;
	private _settings: Gio.Settings | null = null;
	private _launcher: Launcher | null = null;
	private _signalHandlers: number[] = [];
	private _displaySignalHandlers: number[] = [];
	private _settingsChangedIds: number[] = [];

	enable() {
		this._settings = this.getSettings();
		this._config = new Config(this._settings);
		this._launcher = new Launcher(this._config, this._settings);

		this._signalHandlers.push(
			global.window_manager.connect("map", (_, win: Meta.WindowActor) => {
				this._launcher?.storeApp(win.get_meta_window())
			})
		);
		this._signalHandlers.push(
			global.window_manager.connect("destroy", (_, win: Meta.WindowActor) => {
				this._launcher?.deleteApp(win.get_meta_window());
			})
		);

		this._displaySignalHandlers.push(
			global.display.connect("notify::focus-window", () => {
				this._launcher?.promoteWindow(global.display.focus_window);
			})
		);

		// Listen for settings changes to reload keybindings
		this._settingsChangedIds.push(
			this._settings.connect("changed::shortcuts", () => {
				this._reloadShortcuts();
			})
		);
		this._settingsChangedIds.push(
			this._settings.connect("changed::win-prev-key", () => {
				this._reloadShortcuts();
			})
		);
		this._settingsChangedIds.push(
			this._settings.connect("changed::win-other-key", () => {
				this._reloadShortcuts();
			})
		);
		this._settingsChangedIds.push(
			this._settings.connect("changed::win-delete-key", () => {
				this._reloadShortcuts();
			})
		);
		this._settingsChangedIds.push(
			this._settings.connect("changed::win-center-mouse", () => {
				this._reloadShortcuts();
			})
		);
	}

	private _reloadShortcuts() {
		if (!this._settings) return;

		// Unbind all current keybindings
		this._config?.entries.forEach((bind) => {
			if (bind.key) {
				Main.wm.removeKeybinding(bind.key);
			}
		});

		// Reload config and launcher
		this._config = new Config(this._settings);
		this._launcher = new Launcher(this._config, this._settings);

		// Refocus the Extensions preferences window
		this._focusExtensionsWindow();
	}

	private _focusExtensionsWindow() {
		const windows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
		for (const win of windows) {
			const wmClass = win.get_wm_class();
			// Match GNOME Extensions app or extension-prefs window
			if (wmClass && (wmClass.includes("Extensions") || wmClass.includes("extension-prefs"))) {
				win.raise_and_make_recent_on_workspace(win.get_workspace());
				win.focus(global.get_current_time());
				return;
			}
		}
	}

	disable() {
		this._signalHandlers.forEach(id => {
			global.window_manager.disconnect(id);
		});
		this._signalHandlers = [];

		this._displaySignalHandlers.forEach(id => {
			global.display.disconnect(id);
		});
		this._displaySignalHandlers = [];

		// Disconnect settings change handlers
		this._settingsChangedIds.forEach(id => {
			this._settings?.disconnect(id);
		});
		this._settingsChangedIds = [];

		this._config?.entries.forEach((bind, _) => {
			if (bind.key) {
				Main.wm.removeKeybinding(bind.key!)
			}
		});

		this._settings?.run_dispose();
		this._settings = null;
		this._config = null;
		this._launcher = null;
	}
}
