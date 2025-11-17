import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";


import Config from "./config.js";
import { App, AppCollection } from "./apps.js";

export default class Launcher {
	private _apps: Map<string, AppCollection>;
	private _settings: Gio.Settings;
	private _boundedAppIds = new Set<string>();
	private _other = "other";
	private _centerMouse = false;
	private _windowTracker: Shell.WindowTracker;
	private _appSystem: Shell.AppSystem;

	constructor(config: Config, settings: Gio.Settings) {
		this._settings = settings;
		this._windowTracker = Shell.WindowTracker.get_default();
		this._appSystem = Shell.AppSystem.get_default();

		try {
			this._bindKeys(config);
			this._apps = this._startUpMapping();
		} catch (error) {
			throw new Error(`[GlaunchV2] Error initializing launcher: ${error}`)
		}
	}

	/**
	 * Normalizes app identifier to desktop file ID format
	 * "firefox_firefox" -> "firefox_firefox.desktop"
	 * "firefox_firefox.desktop" -> "firefox_firefox.desktop"
	 */
	private _normalizeAppId(appId: string): string {
		if (appId === this._other) return this._other;
		return appId.endsWith('.desktop') ? appId : `${appId}.desktop`;
	}

	/**
	 * Normalizes app name by removing parenthetical suffixes
	 * "Emacs (Client)" -> "Emacs"
	 */
	private _normalizeAppName(appName: string): string {
		return appName.replace(/\s*\([^)]*\)/, '');
	}

	/**
	 * Gets the app ID (desktop file ID) for a window
	 * Returns "other" if window doesn't belong to a bound app
	 */
	private _getAppIdForWindow(win: Meta.Window | null): string {
		if (!win) return this._other;

		try {
			const shellApp = this._windowTracker.get_window_app(win);
			if (!shellApp) return this._other;

			let appId = shellApp.get_id();
			if (!appId) return this._other;

			// Normalize the app ID by removing parentheticals
			// This handles cases like emacsclient showing as "Emacs (Client)"
			const normalizedId = this._normalizeAppName(appId);

			// Check both the original and normalized app ID
			if (this._boundedAppIds.has(appId)) {
				return appId;
			}

			// Check if any bound app matches the normalized name
			for (const boundId of this._boundedAppIds) {
				const normalizedBoundId = this._normalizeAppName(boundId);
				if (normalizedId.toLowerCase().includes(normalizedBoundId.toLowerCase().replace('.desktop', '')) ||
				    normalizedBoundId.toLowerCase().includes(normalizedId.toLowerCase().replace('.desktop', ''))) {
					return boundId;
				}
			}

			return this._other;
		} catch (error) {
			console.warn(`[GlaunchV2] Error getting app ID for window: ${error}`);
			return this._other;
		}
	}

	storeApp(win: Meta.Window | null) {
		if (!win) return;
		if (win.get_wm_class_instance() === 'gjs') return;
		if (win.get_window_type() !== Meta.WindowType.NORMAL) return;

		try {
			const appId = this._getAppIdForWindow(win);

			if (this._apps.has(appId)) {
				console.debug(`[GlaunchV2] Adding window to ${appId}`);
				this._apps.get(appId)?.storeApp(win);
			} else {
				console.debug(`[GlaunchV2] Creating new collection for ${appId}`);
				const app = new App(win);
				this._apps.set(appId, new AppCollection(app, this._centerMouse));
			}
		} catch (error) {
			console.warn(`[GlaunchV2] Error storing app: ${error}`);
		}
	}

	deleteApp(win: Meta.Window | null) {
		if (!win) return;
		try {
			const appId = this._getAppIdForWindow(win);
			const appCol = this._apps.get(appId);

			if (appCol) {
				console.debug(`[GlaunchV2] Removing window from ${appId}`);
				appCol.deleteApp(win);

				if (appCol.size() === 0) {
					console.debug(`[GlaunchV2] Removing empty collection: ${appId}`);
					this._apps.delete(appId);
				}
			}
		} catch (error) {
			console.warn(`[GlaunchV2] Error deleting app: ${error}`);
		}
	}

	private _handleApp(appId: string) {
		const normalizedAppId = this._normalizeAppId(appId);
		const focusedAppId = this._getAppIdForWindow(global.display.focus_window);

		console.debug(`[GlaunchV2] Handling app: ${normalizedAppId}`);
		console.debug(`[GlaunchV2] Currently focused: ${focusedAppId}`);

		if (focusedAppId === normalizedAppId && this._apps.has(normalizedAppId)) {
			// Same app focused -> cycle to next window
			console.debug(`[GlaunchV2] Cycling to next window`);
			this._apps.get(normalizedAppId)?.goNext();
		} else if (this._apps.has(normalizedAppId)) {
			// App has windows but not focused -> switch to it
			console.debug(`[GlaunchV2] Switching to app`);
			this._apps.get(normalizedAppId)?.switchToApp();
		} else {
			// App not running -> launch it
			console.debug(`[GlaunchV2] Launching new instance`);
			const shellApp = this._appSystem.lookup_app(normalizedAppId);
			if (shellApp) {
				shellApp.activate();
			} else {
				console.error(`[GlaunchV2] Could not find app: ${normalizedAppId}`);
			}
		}
	}

	private _goToPrev() {
		const mruWindows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
		if (mruWindows.length < 2) return;
		new App(mruWindows[1]).focus(this._centerMouse);
	}

	private _deleteWin() {
		global.display.focus_window?.delete(global.get_current_time());
	}

	private _bindKeys(config: Config) {
		config.entries.forEach((bind) => {
			switch (bind.act) {
				case "launch":
					Main.wm.addKeybinding(
						bind.key!,
						this._settings,
						Meta.KeyBindingFlags.NONE,
						Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
						() => this._handleApp(bind.app!)
					);

					// Store the normalized app ID in our bounded set
					const appId = this._normalizeAppId(bind.app!);
					if (appId !== this._other) {
						this._boundedAppIds.add(appId);
						console.debug(`[GlaunchV2] Bound app: ${appId}`);
					}
					break;

				case "win_other":
					Main.wm.addKeybinding(
						bind.key!,
						this._settings,
						Meta.KeyBindingFlags.NONE,
						Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
						() => this._handleApp(this._other)
					);
					break;

				case "win_delete":
					Main.wm.addKeybinding(
						bind.key!,
						this._settings,
						Meta.KeyBindingFlags.NONE,
						Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
						() => this._deleteWin()
					);
					break;

				case "win_prev":
					Main.wm.addKeybinding(
						bind.key!,
						this._settings,
						Meta.KeyBindingFlags.NONE,
						Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
						() => this._goToPrev()
					);
					break;

				case "win_center_mouse":
					this._centerMouse = true;
					break;
			}
		});
	}

	private _startUpMapping(): Map<string, AppCollection> {
		const openedAppsMap = new Map<string, AppCollection>();
		const openedApps = global.display.get_tab_list(Meta.TabList.NORMAL, null);

		openedApps.forEach(window => {
			try {
				const appId = this._getAppIdForWindow(window);
				if (openedAppsMap.has(appId)) {
					openedAppsMap.get(appId)!.storeApp(window);
				} else {
					openedAppsMap.set(
						appId,
						new AppCollection(new App(window), this._centerMouse)
					);
				}
			} catch (error) {
				console.warn(`[GlaunchV2] Error mapping window: ${error}`);
			}
		});

		return openedAppsMap;
	}
}
