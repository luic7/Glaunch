import Gio from "gi://Gio";

interface ShortcutConfig {
	app: string;
	key: string;
	name: string;
}

export interface ConfigEntry {
	act: string;
	key?: string;
	app?: string;
}

export default class Config {
	entries: ConfigEntry[];

	constructor(settings: Gio.Settings) {
		this.entries = this._loadFromSettings(settings);
	}

	private _loadFromSettings(settings: Gio.Settings): ConfigEntry[] {
		const config: ConfigEntry[] = [];

		// Load app shortcuts from GSettings
		const shortcutsJson = settings.get_string("shortcuts") ?? "";
		if (shortcutsJson) {
			try {
				const shortcuts = JSON.parse(shortcutsJson) as ShortcutConfig[];
				for (const shortcut of shortcuts) {
					config.push({
						act: "launch",
						key: shortcut.key.toLowerCase(),
						app: shortcut.app,
					});
					console.debug(`[GlaunchV2] Loaded shortcut: ${shortcut.key} -> ${shortcut.app}`);
				}
			} catch (error) {
				console.error(`[GlaunchV2] Error parsing shortcuts: ${error}`);
			}
		}

		// Add window management keybindings from settings
		const winPrevKey = settings.get_string("win-prev-key") ?? "";
		if (winPrevKey) {
			config.push({ act: "win_prev", key: winPrevKey.toLowerCase() });
		}

		const winOtherKey = settings.get_string("win-other-key") ?? "";
		if (winOtherKey) {
			config.push({ act: "win_other", key: winOtherKey.toLowerCase() });
		}

		const winDeleteKey = settings.get_string("win-delete-key") ?? "";
		if (winDeleteKey) {
			config.push({ act: "win_delete", key: winDeleteKey.toLowerCase() });
		}

		const winCenterMouse = settings.get_boolean("win-center-mouse");
		if (winCenterMouse) {
			config.push({ act: "win_center_mouse" });
		}

		return config;
	}
}
