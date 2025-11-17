import GLib from "gi://GLib";
import Gio from "gi://Gio";

const DEFAULT_CONFIG = `# GlaunchV2 Configuration
# Format: <action> <key> <app_id>
# App IDs can be with or without .desktop suffix
# Find app IDs in: /usr/share/applications, /var/lib/snapd/desktop/applications, /var/lib/flatpak/exports/share/applications

# App Shortcuts
launch f9 firefox_firefox.desktop
launch f10 emacsclient.desktop
launch f11 kitty.desktop

# Window Management
win_prev f4
win_other f12
win_delete f3
win_center_mouse
`;

interface ConfigEntry {
	act: string;
	key?: string;
	app?: string;
}


export default class Config {
	entries: ConfigEntry[];
	constructor() {
		const file = this._getConfigFile();
		this.entries = this._createConfigMap(file);
	}

	private _getConfigFile(): Gio.File {
		const configDir: string = `${GLib.get_home_dir()}/.config/glaunchv2`;
		const file: Gio.File = Gio.File.new_for_path(`${configDir}/glaunch.conf`);

		if (!file.query_exists(null)) {
			const success = this._createConfigFile(configDir, file);
			if (!success) {
				throw new Error("[GlaunchV2] Error config file");
			}
		}

		return file;
	}

	private _createConfigMap(
		file: Gio.File,
	): ConfigEntry[] {
		const [success, contents]: [boolean, Uint8Array, ...unknown[]] =
			file.load_contents(null);

		if (!success) {
			throw new Error("[GlaunchV2] Error Loading config file");
		}

		const config: ConfigEntry[] = [];
		const configurationLines = new TextDecoder("utf-8").decode(contents);
		configurationLines.split("\n").forEach((line, lineNumber) => {
			if (line.trim() === "" || line.trim().startsWith("#")) {
				return;
			}

			const parts = line.trim().split(/\s+/);
			if (parts.length === 1) {
				config.push({
					act: parts[0],
				});
			} else if (parts.length === 2) {
				config.push({
					act: parts[0],
					key: parts[1],
				});
			}
			else if (parts.length === 3) {
				config.push({
					act: parts[0],
					key: parts[1],
					app: parts[2],
				});
			} else {
				console.warn(
					`[GlaunchV2] Ignoring malformed config line ${lineNumber + 1}`,
				);
			}
		});

		return config;
	}

	private _createConfigFile(configDir: string, file: Gio.File): boolean {
		let outputStream: Gio.OutputStream | null = null;
		try {
			const dir: Gio.File = Gio.File.new_for_path(configDir);
			if (!dir.query_exists(null)) {
				dir.make_directory_with_parents(null);
			}

			outputStream = file.create(Gio.FileCreateFlags.NONE, null);
			const bytes = new TextEncoder().encode(DEFAULT_CONFIG);
			outputStream.write_bytes(bytes, null);
			return true
		} catch (error) {
			throw new Error(`[GlaunchV2] Error creating config file: ${error}`);
		} finally {
			if (outputStream) {
				try {
					outputStream.close(null);
				} catch (closeError) {
					console.error(`[GlaunchV2] Error closing output stream: ${closeError}`);
				}
			}
		}
	}
}
