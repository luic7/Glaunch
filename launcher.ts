import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";


import Config from "./config.js";
import { App, AppCollection } from "./apps.js";

export default class Launcher {
	private _apps;
	private _settings: Gio.Settings;
	private _bounded = new Set<string>();
	private _other = "other";
	private _centerMouse = false;

	constructor(config: Config, settings: Gio.Settings) {
		this._settings = settings;

		try {
			this._bindKeys(config);
			this._apps = this._startUpMapping();
		} catch (error) {
			throw new Error(`[GlaunchV2] Error initializing launcher: ${error}`)
		}
	}

	storeApp(win: Meta.Window | null) {
		if (!win) return;
		if (win.get_wm_class_instance() === 'gjs') return;
		if (win.get_window_type() !== Meta.WindowType.NORMAL) return;

		try {
			const mapName = this._retrieveMapName(win);
			if (!mapName) {
				console.debug('[GlaunchV2] Could not determine map name for window, skipping');
				return;
			}

			if (this._apps.has(mapName)) {
				console.debug(`[GlaunchV2] Adding window to existing collection: ${mapName}`);
				this._apps.get(mapName)?.storeApp(win);
			} else {
				console.debug(`[GlaunchV2] Creating new collection for: ${mapName}`);
				const app = new App(win);
				this._apps.set(mapName, new AppCollection(app, this._centerMouse));
			}
		} catch (error) {
			console.warn(`[GlaunchV2] Error storing app: ${error}`);
		}
	}

	deleteApp(win: Meta.Window | null) {
		if (!win) return;
		try {
			const mapName = this._retrieveMapName(win);
			if (!mapName) {
				console.debug('[GlaunchV2] Could not determine map name for window, skipping deletion');
				return;
			}

			const appCol = this._apps.get(mapName);
			if (appCol) {
				console.debug(`[GlaunchV2] Removing window from collection: ${mapName}`);
				appCol.deleteApp(win);

				if (appCol.size() === 0) {
					console.debug(`[GlaunchV2] Removing empty collection: ${mapName}`);
					this._apps.delete(mapName);
				}
			}
		} catch (error) {
			console.warn(`[GlaunchV2] Error deleting app: ${error}`);
		}
	}

	private _handleApp(appName: string) {
		const focusedName = this._retrieveMapName(global.display.focus_window);
		let appDesktopName = this._retrieveDesktopName(appName)

		if (appDesktopName) {
			appDesktopName = appDesktopName.replace(/\s*\([^)]*\)/, '');
		}

		if (!appDesktopName) {
			console.error(`[GlaunchV2-New] Error: No desktop name found for ${appName}.desktop`);
			return;
		}

		if (focusedName === appDesktopName && this._apps.has(appDesktopName)) {
			console.error(`[GlaunchV2-New] Taking path: goNext()`);
			this._apps.get(appDesktopName)?.goNext();
		} else if (this._apps.has(appDesktopName)) {
			console.error(`[GlaunchV2-New] Taking path: switchToApp()`);
			this._apps.get(appDesktopName)?.switchToApp();
		} else {
			console.error(`[GlaunchV2-New] Taking path: launch new app`);
			Gio.DesktopAppInfo.new(appName + ".desktop")?.launch([], null);
		}
	}

	private _goToPrev() {
		const mruWindows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
		if (mruWindows.length < 2) return;
		new App(mruWindows[1]).focus(this._centerMouse);

	}

	private _deleteWin() {
		global.display.focus_window.delete(global.get_current_time());
	}

	private _bindKeys(config: Config) {
		config.entries.forEach((bind, _) => {
			switch (bind.act) {
				case "launch":
					Main.wm.addKeybinding(
						bind.key!,
						this._settings,
						Meta.KeyBindingFlags.NONE,
						Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
						() => this._handleApp(bind.app!))

					const appName = this._retrieveDesktopName(bind.app!)
					if (appName && appName !== this._other) {
						const normalizedAppName = appName.replace(/\s*\([^)]*\)/, '');
						this._bounded.add(normalizedAppName);
					}
					break;
				case "win_other":
					Main.wm.addKeybinding(
						bind.key!,
						this._settings,
						Meta.KeyBindingFlags.NONE,
						Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
						() => this._handleApp(this._other))
					break;
				case "win_delete":
					Main.wm.addKeybinding(
						bind.key!,
						this._settings,
						Meta.KeyBindingFlags.NONE,
						Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
						() => this._deleteWin())
					break;
				case "win_prev":
					Main.wm.addKeybinding(
						bind.key!,
						this._settings,
						Meta.KeyBindingFlags.NONE,
						Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
						() => this._goToPrev())
					break;
				case "win_center_mouse":
					this._centerMouse = true
					break
			}

		})
	}

	private _startUpMapping(): Map<string, AppCollection> {
		let openedAppsMap = new Map<string, AppCollection>();
		let openedApps = global.display.get_tab_list(Meta.TabList.NORMAL, null);

		openedApps.forEach(appInstance => {
			try {
				const mapName = this._retrieveMapName(appInstance);
				openedAppsMap
					.has(mapName)
					? openedAppsMap.get(mapName)!.storeApp(appInstance)
					: openedAppsMap.set(mapName, new AppCollection(new App(appInstance), this._centerMouse));
			} catch (error) {
				console.warn(`[GlaunchV2] Error mapping window: ${error}`);
			}
		});

		return openedAppsMap;
	}

	private _retrieveMapName(win: Meta.Window): string {
		if (!win) return "";

		try {
			const wmClass = win.get_wm_class();
			if (!wmClass) return "";

			const appName = wmClass.toLowerCase().replace(/[0-9]/g, '');

			const searchResults = Gio.DesktopAppInfo.search(appName);
			if (!searchResults || !searchResults[0] || searchResults[0].length === 0) {
				return this._other;
			}

			const appFileName = searchResults[0].reduce(
				(shortest, current) => current.length < shortest.length ? current : shortest,
				searchResults[0][0]
			);

			const appInfo = appFileName ? Gio.DesktopAppInfo.new(appFileName) : null;
			if (!appInfo) return this._other;

			const appDesktopName = appInfo.get_locale_string("Name") || "";
			console.warn(`[GlaunchV2-New] Window desktop name: ${appDesktopName}`);
			console.warn(`[GlaunchV2-New] Bounded apps:`, Array.from(this._bounded));
			console.warn(`[GlaunchV2-New] Is bounded:`, this._bounded.has(appDesktopName));

			return this._bounded.has(appDesktopName) ? appDesktopName : this._other;
		} catch (error) {
			console.warn(`[GlaunchV2] Error retrieving map name for window: ${error}`);
			return "";
		}
	}

	private _retrieveDesktopName(appName: string): string {
		console.error(`[GlaunchV2-New] _retrieveDesktopName called with: ${appName}`);
		if (!appName) return ""
		if (appName === this._other) return this._other

		const desktopFile = appName + ".desktop";
		console.error(`[GlaunchV2-New] Looking for desktop file: ${desktopFile}`);

		const appInfo = Gio.DesktopAppInfo.new(desktopFile);
		const result = appInfo?.get_locale_string("Name") ?? "";
		console.error(`[GlaunchV2-New] Desktop file result: ${result}`);

		return result;
	}

}
