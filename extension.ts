import Gio from "gi://Gio";
import Meta from "gi://Meta";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import Config from "./config.js";
import Launcher from "./launcher.js";

// Settings edited in the preferences window. Changing any of them rebuilds the
// launcher, so the new bindings apply without restarting GNOME Shell.
const PREFS_KEYS = ["shortcuts", "win-prev-key", "win-other-key", "win-delete-key", "win-center-mouse"];

export default class Glaunch extends Extension {
	private _settings: Gio.Settings | null = null;
	private _launcher: Launcher | null = null;
	private _windowManagerSignalIds: number[] = [];
	private _displaySignalIds: number[] = [];
	private _settingsSignalIds: number[] = [];

	enable() {
		this._settings = this.getSettings();
		this._launcher = new Launcher(new Config(this._settings), this._settings);

		this._windowManagerSignalIds.push(
			global.window_manager.connect("map", (_, win: Meta.WindowActor) => {
				this._launcher?.storeApp(win.get_meta_window())
			})
		);
		this._windowManagerSignalIds.push(
			global.window_manager.connect("destroy", (_, win: Meta.WindowActor) => {
				this._launcher?.deleteApp(win.get_meta_window());
			})
		);

		this._displaySignalIds.push(
			global.display.connect("notify::focus-window", () => {
				this._launcher?.promoteWindow(global.display.focus_window);
			})
		);

		for (const key of PREFS_KEYS) {
			this._settingsSignalIds.push(
				this._settings.connect(`changed::${key}`, () => {
					this._reloadShortcuts();
				})
			);
		}
	}

	disable() {
		this._windowManagerSignalIds.forEach(id => {
			global.window_manager.disconnect(id);
		});
		this._windowManagerSignalIds = [];

		this._displaySignalIds.forEach(id => {
			global.display.disconnect(id);
		});
		this._displaySignalIds = [];

		this._settingsSignalIds.forEach(id => {
			this._settings?.disconnect(id);
		});
		this._settingsSignalIds = [];

		this._launcher?.destroy();

		this._settings = null;
		this._launcher = null;
	}

	private _reloadShortcuts() {
		if (!this._settings) return;

		this._launcher?.destroy();
		this._launcher = new Launcher(new Config(this._settings), this._settings);

		this._focusExtensionsWindow();
	}

	// The new Launcher re-maps the open windows, and AppCollection.storeApp()
	// focuses windows as it adds them, which can take focus away from the
	// preferences window the user is editing.
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
}
