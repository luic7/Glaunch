import Gio from "gi://Gio";

// An entry of the "shortcuts" setting, which prefs.ts stores as a JSON array
// of {app, key, name}.
interface Shortcut {
	key: string;
	app: string;
}

export default class Config {
	shortcuts: Shortcut[];
	// Function keys for the window actions; empty when set to "None".
	winPrevKey: string;
	winOtherKey: string;
	winDeleteKey: string;
	winCenterMouse: boolean;

	constructor(settings: Gio.Settings) {
		this.shortcuts = this._readShortcuts(settings);
		this.winPrevKey = settings.get_string("win-prev-key").toLowerCase();
		this.winOtherKey = settings.get_string("win-other-key").toLowerCase();
		this.winDeleteKey = settings.get_string("win-delete-key").toLowerCase();
		this.winCenterMouse = settings.get_boolean("win-center-mouse");
	}

	private _readShortcuts(settings: Gio.Settings): Shortcut[] {
		const shortcuts: Shortcut[] = [];

		const shortcutsJson = settings.get_string("shortcuts");
		if (shortcutsJson) {
			try {
				for (const shortcut of JSON.parse(shortcutsJson) as Shortcut[]) {
					shortcuts.push({ key: shortcut.key.toLowerCase(), app: shortcut.app });
				}
			} catch (error) {
				console.error(`[Glaunch] Error parsing shortcuts: ${error}`);
			}
		}

		return shortcuts;
	}
}
