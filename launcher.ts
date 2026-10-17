import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";

import Config from "./config.js";
import { App, AppCollection } from "./apps.js";

// Shell.App.get_app_info() returns a GDesktopAppInfo, which the installed GIR
// typings don't describe (it moved to GioUnix), so declare the part we use.
interface DesktopAppInfo {
	get_startup_wm_class(): string | null;
}

interface MaximizableWindow {
	is_maximized(): boolean;
	maximize(): void;
	unmaximize(): void;
}

export default class Launcher {
	private _apps = new Map<string, AppCollection>();
	private _settings: Gio.Settings;
	private _boundedAppIds = new Set<string>();
	// Lowercased StartupWMClass -> ID of the bound app that declares it.
	private _boundedWmClasses = new Map<string, string>();
	private _boundedKeys = new Set<string>();
	// Apps launched by their key whose first window hasn't appeared yet.
	private _launchedAppIds = new Set<string>();
	private _other = "other";
	private _centerMouse: boolean;
	private _resizingWin: Meta.Window | null = null;
	private _sizeChangedId = 0;
	private _resizeTimeoutId = 0;
	private _windowTracker: Shell.WindowTracker;
	private _appSystem: Shell.AppSystem;

	constructor(config: Config, settings: Gio.Settings) {
		this._settings = settings;
		this._centerMouse = config.winCenterMouse;
		this._windowTracker = Shell.WindowTracker.get_default();
		this._appSystem = Shell.AppSystem.get_default();

		try {
			this._bindKeys(config);
			this._startUpMapping();
		} catch (error) {
			throw new Error(`[Glaunch] Error initializing launcher: ${error}`)
		}
	}

	destroy() {
		for (const key of this._boundedKeys) {
			Main.wm.removeKeybinding(key);
		}
		this._boundedKeys.clear();

		if (this._centerMouse) {
			Meta.keybindings_set_custom_handler("toggle-maximized", null);
		}
		this._cancelCenterMouse();
	}

	storeApp(win: Meta.Window | null) {
		if (!win) return;
		if (win.get_title() === 'wl-clipboard') return;
		if (win.get_wm_class_instance() === 'gjs') return;
		if (win.get_wm_class_instance() === 'ibus-ui-gtk3') return;
		if (win.get_wm_class_instance() === 'gnome-control-center-global-shortcuts-provider') return;
		if (win.get_window_type() !== Meta.WindowType.NORMAL) return;

		try {
			this._addWindow(win);
		} catch (error) {
			console.warn(`[Glaunch] Error storing app: ${error}`);
		}
	}

	deleteApp(win: Meta.Window | null) {
		if (!win) return;
		try {
			const appId = this._getAppIdForWindow(win);
			const appCol = this._apps.get(appId);

			if (appCol) {
				appCol.deleteApp(win);

				if (appCol.size() === 0) {
					this._apps.delete(appId);
				}
			}
		} catch (error) {
			console.warn(`[Glaunch] Error deleting app: ${error}`);
		}
	}

	promoteWindow(win: Meta.Window | null) {
		if (!win) return;
		if (win.get_window_type() !== Meta.WindowType.NORMAL) return;

		try {
			const appId = this._getAppIdForWindow(win);
			const appCol = this._apps.get(appId);

			if (appCol) {
				appCol.setHead(win);
			}
		} catch (error) {
			console.warn(`[Glaunch] Error promoting window: ${error}`);
		}
	}

	private _bindKeys(config: Config) {
		for (const { key, app } of config.shortcuts) {
			this._bindKey(key, () => this._handleApp(app));
			this._addBoundApp(app);
		}

		if (config.winPrevKey) {
			this._bindKey(config.winPrevKey, () => this._goToPrev());
		}
		if (config.winOtherKey) {
			this._bindKey(config.winOtherKey, () => this._handleApp(this._other));
		}
		if (config.winDeleteKey) {
			this._bindKey(config.winDeleteKey, () => this._deleteWin());
		}

		if (config.winCenterMouse) {
			Main.wm.setCustomKeybindingHandler(
				"toggle-maximized",
				Shell.ActionMode.NORMAL,
				(_display, win) => this._toggleMaximized(win)
			);
		}
	}

	private _bindKey(key: string, handler: () => void) {
		Main.wm.addKeybinding(
			key,
			this._settings,
			Meta.KeyBindingFlags.NONE,
			Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
			handler
		);
		this._boundedKeys.add(key);
	}

	private _handleApp(app: string) {
		const appId = this._normalizeAppId(app);
		const focusedAppId = this._getAppIdForWindow(global.display.focus_window);
		const appCol = this._apps.get(appId);

		if (!appCol) {
			const shellApp = this._appSystem.lookup_app(appId);
			if (shellApp) {
				shellApp.activate();
				if (this._centerMouse) {
					this._launchedAppIds.add(appId);
				}
			} else {
				console.error(`[Glaunch] Could not find app: ${appId}`);
			}
		} else if (focusedAppId !== appId) {
			appCol.switchToApp();
		} else {
			appCol.goNext();
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

	private _toggleMaximized(win: Meta.Window | null) {
		if (!win) return;

		const maxWin = win as unknown as MaximizableWindow;
		const maximized = maxWin.is_maximized();
		if (!maximized && !win.can_maximize()) return;

		this._centerMouseAfterResize(win);

		if (maximized) {
			maxWin.unmaximize();
		} else {
			maxWin.maximize();
		}
	}

	private _centerMouseAfterResize(win: Meta.Window) {
		this._cancelCenterMouse();

		const center = () => {
			this._cancelCenterMouse();
			if (win === global.display.focus_window) {
				new App(win).centerMouse();
			}
		};

		this._resizingWin = win;
		this._sizeChangedId = win.connect("size-changed", center);
		this._resizeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
			this._resizeTimeoutId = 0;
			center();
			return GLib.SOURCE_REMOVE;
		});
	}

	private _cancelCenterMouse() {
		if (this._resizingWin) {
			this._resizingWin.disconnect(this._sizeChangedId);
			this._resizingWin = null;
		}
		if (this._resizeTimeoutId) {
			GLib.source_remove(this._resizeTimeoutId);
			this._resizeTimeoutId = 0;
		}
	}

	private _startUpMapping() {
		const openedApps = global.display.get_tab_list(Meta.TabList.NORMAL, null);

		openedApps.forEach(window => {
			try {
				this._addWindow(window);
			} catch (error) {
				console.warn(`[Glaunch] Error mapping window: ${error}`);
			}
		});
	}

	private _addWindow(win: Meta.Window) {
		const appId = this._getAppIdForWindow(win);
		const appCol = this._apps.get(appId);

		if (appCol) {
			appCol.storeApp(win);
			return;
		}

		const newCol = new AppCollection(new App(win), this._centerMouse);
		this._apps.set(appId, newCol);

		// Unlike storeApp(), a new collection doesn't focus its first window, so
		// focus (and center the mouse on) the window of an app we just launched.
		if (this._launchedAppIds.delete(appId)) {
			newCol.switchToApp();
		}
	}

	private _addBoundApp(app: string) {
		const appId = this._normalizeAppId(app);
		if (appId === this._other) return;

		this._boundedAppIds.add(appId);

		const appInfo = this._appSystem.lookup_app(appId)?.get_app_info() as DesktopAppInfo | null;
		const wmClass = appInfo?.get_startup_wm_class()?.toLowerCase();
		// If two bound apps declare the same class, the first shortcut wins.
		if (wmClass && !this._boundedWmClasses.has(wmClass)) {
			this._boundedWmClasses.set(wmClass, appId);
		}
	}

	/**
	 * Returns the ID of the bound app a window belongs to, or "other".
	 */
	private _getAppIdForWindow(win: Meta.Window | null): string {
		if (!win) return this._other;

		try {
			const appId = this._windowTracker.get_window_app(win)?.get_id();
			if (appId && this._boundedAppIds.has(appId)) {
				return appId;
			}

			// Several desktop files can describe the same windows: emacs.desktop and
			// emacsclient.desktop both declare StartupWMClass=Emacs, and GNOME may
			// attribute a frame opened with emacsclient to emacs.desktop. So also
			// match the window's WM class against the classes the bound apps
			// declare, ignoring case ("Emacs" on X11, "emacs" on Wayland).
			for (const wmClass of [win.get_wm_class(), win.get_wm_class_instance()]) {
				if (!wmClass) continue;

				const boundAppId = this._boundedWmClasses.get(wmClass.toLowerCase());
				if (boundAppId) {
					return boundAppId;
				}
			}

			return this._other;
		} catch (error) {
			console.warn(`[Glaunch] Error getting app ID for window: ${error}`);
			return this._other;
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
}
