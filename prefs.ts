import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

interface ShortcutConfig {
	app: string;
	key: string;
	name: string;
}

interface DesktopApp {
	id: string;
	name: string;
}

const FUNCTION_KEYS = [
	"F1", "F2", "F3", "F4", "F5", "F6",
	"F7", "F8", "F9", "F10", "F11", "F12"
];

const FUNCTION_KEYS_WITH_NONE = ["None", ...FUNCTION_KEYS];

export default class GlaunchPreferences extends ExtensionPreferences {
	private _settings: Gio.Settings | null = null;

	fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
		this._settings = this.getSettings();

		const page = new Adw.PreferencesPage({
			title: "Shortcuts",
			iconName: "preferences-desktop-keyboard-shortcuts-symbolic",
		});

		const group = new Adw.PreferencesGroup({
			title: "Custom Shortcuts",
			description: "Assign function keys to launch applications",
		});

		page.add(group);

		// Add existing shortcuts
		this._loadShortcuts(group);

		// Add button row
		const addButton = new Gtk.Button({
			iconName: "list-add-symbolic",
			cssClasses: ["flat"],
			valign: Gtk.Align.CENTER,
			halign: Gtk.Align.CENTER,
		});

		const addRow = new Adw.ActionRow({
			title: "",
			activatable: true,
		});
		addRow.set_child(addButton);

		addButton.connect("clicked", () => {
			this._showAddShortcutDialog(window, group);
		});

		group.add(addRow);

		// Window Management group
		const wmGroup = new Adw.PreferencesGroup({
			title: "Window Management",
			description: "Configure window management shortcuts",
		});

		// Previous window key
		const prevWindowRow = new Adw.ComboRow({
			title: "Previous Window",
			subtitle: "Switch to previously focused window",
		});
		const prevKeyModel = new Gtk.StringList();
		for (const key of FUNCTION_KEYS_WITH_NONE) {
			prevKeyModel.append(key);
		}
		prevWindowRow.set_model(prevKeyModel);
		this._setComboFromSetting(prevWindowRow, "win-prev-key");
		prevWindowRow.connect("notify::selected", () => {
			this._saveKeyFromCombo(prevWindowRow, "win-prev-key");
		});
		wmGroup.add(prevWindowRow);

		// Cycle other windows key
		const otherWindowRow = new Adw.ComboRow({
			title: "Cycle Other Windows",
			subtitle: "Cycle through non-configured windows",
		});
		const otherKeyModel = new Gtk.StringList();
		for (const key of FUNCTION_KEYS_WITH_NONE) {
			otherKeyModel.append(key);
		}
		otherWindowRow.set_model(otherKeyModel);
		this._setComboFromSetting(otherWindowRow, "win-other-key");
		otherWindowRow.connect("notify::selected", () => {
			this._saveKeyFromCombo(otherWindowRow, "win-other-key");
		});
		wmGroup.add(otherWindowRow);

		// Close window key
		const deleteWindowRow = new Adw.ComboRow({
			title: "Close Window",
			subtitle: "Close the currently focused window",
		});
		const deleteKeyModel = new Gtk.StringList();
		for (const key of FUNCTION_KEYS_WITH_NONE) {
			deleteKeyModel.append(key);
		}
		deleteWindowRow.set_model(deleteKeyModel);
		this._setComboFromSetting(deleteWindowRow, "win-delete-key");
		deleteWindowRow.connect("notify::selected", () => {
			this._saveKeyFromCombo(deleteWindowRow, "win-delete-key");
		});
		wmGroup.add(deleteWindowRow);

		// Center mouse toggle
		const centerMouseRow = new Adw.SwitchRow({
			title: "Center Mouse on Focus",
			subtitle: "Move mouse cursor to center of focused window",
		});
		centerMouseRow.set_active(this._settings?.get_boolean("win-center-mouse") ?? true);
		centerMouseRow.connect("notify::active", () => {
			this._settings?.set_boolean("win-center-mouse", centerMouseRow.get_active());
		});
		wmGroup.add(centerMouseRow);

		page.add(wmGroup);

		window.add(page);

		return Promise.resolve();
	}

	private _setComboFromSetting(comboRow: Adw.ComboRow, settingKey: string): void {
		const value = this._settings?.get_string(settingKey) ?? "";
		if (!value) {
			comboRow.set_selected(0); // None
		} else {
			const index = FUNCTION_KEYS_WITH_NONE.findIndex(
				(k) => k.toLowerCase() === value.toLowerCase()
			);
			comboRow.set_selected(index >= 0 ? index : 0);
		}
	}

	private _saveKeyFromCombo(comboRow: Adw.ComboRow, settingKey: string): void {
		const selected = comboRow.get_selected();
		if (selected === 0) {
			// None selected
			this._settings?.set_string(settingKey, "");
		} else {
			this._settings?.set_string(settingKey, FUNCTION_KEYS_WITH_NONE[selected].toLowerCase());
		}
	}

	private _loadShortcuts(group: Adw.PreferencesGroup): void {
		const shortcuts = this._getShortcuts();

		for (const shortcut of shortcuts) {
			this._addShortcutRow(group, shortcut);
		}
	}

	private _getShortcuts(): ShortcutConfig[] {
		const shortcutsJson = this._settings?.get_string("shortcuts") ?? "";
		if (!shortcutsJson) {
			return [];
		}

		try {
			return JSON.parse(shortcutsJson) as ShortcutConfig[];
		} catch {
			return [];
		}
	}

	private _saveShortcuts(shortcuts: ShortcutConfig[]): void {
		this._settings?.set_string("shortcuts", JSON.stringify(shortcuts));
	}

	private _addShortcutRow(group: Adw.PreferencesGroup, shortcut: ShortcutConfig): void {
		const row = new Adw.ActionRow({
			title: shortcut.name || shortcut.app,
			subtitle: shortcut.app,
		});

		const keyLabel = new Gtk.Label({
			label: shortcut.key.toUpperCase(),
			cssClasses: ["dim-label"],
			valign: Gtk.Align.CENTER,
		});

		const deleteButton = new Gtk.Button({
			iconName: "edit-delete-symbolic",
			cssClasses: ["flat", "circular"],
			valign: Gtk.Align.CENTER,
		});

		deleteButton.connect("clicked", () => {
			this._removeShortcut(shortcut, group, row);
		});

		row.add_suffix(keyLabel);
		row.add_suffix(deleteButton);

		// Insert before the add button row (which is last)
		const children: Gtk.Widget[] = [];
		let child = group.get_first_child();
		while (child) {
			children.push(child);
			child = child.get_next_sibling();
		}

		if (children.length > 0) {
			// Remove the add button temporarily
			const lastChild = children[children.length - 1];
			group.remove(lastChild);
			group.add(row);
			group.add(lastChild);
		} else {
			group.add(row);
		}
	}

	private _removeShortcut(
		shortcut: ShortcutConfig,
		group: Adw.PreferencesGroup,
		row: Adw.ActionRow
	): void {
		const shortcuts = this._getShortcuts();
		const index = shortcuts.findIndex(
			(s) => s.app === shortcut.app && s.key === shortcut.key
		);

		if (index >= 0) {
			shortcuts.splice(index, 1);
			this._saveShortcuts(shortcuts);
			group.remove(row);
		}
	}

	private _showAddShortcutDialog(
		window: Adw.PreferencesWindow,
		group: Adw.PreferencesGroup
	): void {
		const dialog = new Adw.Dialog({
			title: "Add Custom Shortcut",
			contentWidth: 400,
			contentHeight: 300,
		});

		const toolbarView = new Adw.ToolbarView();
		dialog.set_child(toolbarView);

		// Header bar with cancel/add buttons
		const headerBar = new Adw.HeaderBar({
			showStartTitleButtons: false,
			showEndTitleButtons: false,
		});

		const cancelButton = new Gtk.Button({
			label: "Cancel",
		});
		cancelButton.connect("clicked", () => {
			dialog.close();
		});

		const addButton = new Gtk.Button({
			label: "Add",
			cssClasses: ["suggested-action"],
		});

		headerBar.pack_start(cancelButton);
		headerBar.pack_end(addButton);

		toolbarView.add_top_bar(headerBar);

		// Content
		const contentBox = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 24,
			marginTop: 24,
			marginBottom: 24,
			marginStart: 24,
			marginEnd: 24,
		});

		// App selection
		const appGroup = new Adw.PreferencesGroup();

		const appRow = new Adw.ComboRow({
			title: "Application",
		});

		const apps = this._getDesktopApps();
		const appModel = new Gtk.StringList();
		for (const app of apps) {
			appModel.append(app.name);
		}
		appRow.set_model(appModel);

		appGroup.add(appRow);
		contentBox.append(appGroup);

		// Key selection
		const keyGroup = new Adw.PreferencesGroup();

		const keyRow = new Adw.ComboRow({
			title: "Shortcut",
		});

		const keyModel = new Gtk.StringList();
		for (const key of FUNCTION_KEYS) {
			keyModel.append(key);
		}
		keyRow.set_model(keyModel);

		keyGroup.add(keyRow);
		contentBox.append(keyGroup);

		toolbarView.set_content(contentBox);

		addButton.connect("clicked", () => {
			const selectedAppIndex = appRow.get_selected();
			const selectedKeyIndex = keyRow.get_selected();

			if (selectedAppIndex >= 0 && selectedAppIndex < apps.length) {
				const selectedApp = apps[selectedAppIndex];
				const selectedKey = FUNCTION_KEYS[selectedKeyIndex].toLowerCase();

				const shortcuts = this._getShortcuts();

				// Check for duplicate key
				const existing = shortcuts.find((s) => s.key === selectedKey);
				if (existing) {
					this._showError(dialog, `Key ${selectedKey.toUpperCase()} is already assigned to ${existing.name}`);
					return;
				}

				const newShortcut: ShortcutConfig = {
					app: selectedApp.id,
					key: selectedKey,
					name: selectedApp.name,
				};

				shortcuts.push(newShortcut);
				this._saveShortcuts(shortcuts);

				this._addShortcutRow(group, newShortcut);

				dialog.close();
			}
		});

		dialog.present(window);
	}

	private _showError(parent: Adw.Dialog, message: string): void {
		const errorDialog = new Adw.AlertDialog({
			heading: "Error",
			body: message,
		});
		errorDialog.add_response("ok", "OK");
		errorDialog.present(parent);
	}

	private _getDesktopApps(): DesktopApp[] {
		const apps: DesktopApp[] = [];
		const appDirs = [
			"/usr/share/applications",
			"/usr/local/share/applications/",
			"/var/lib/snapd/desktop/applications",
			"/var/lib/flatpak/exports/share/applications",
			`${GLib.get_home_dir()}/.local/share/applications`,
			`${GLib.get_home_dir()}/.local/share/flatpak/exports/share/applications`,
		];

		for (const dirPath of appDirs) {
			const dir = Gio.File.new_for_path(dirPath);
			if (!dir.query_exists(null)) {
				continue;
			}

			try {
				const enumerator = dir.enumerate_children(
					"standard::name,standard::type",
					Gio.FileQueryInfoFlags.NONE,
					null
				);

				let fileInfo: Gio.FileInfo | null;
				while ((fileInfo = enumerator.next_file(null)) !== null) {
					const fileName = fileInfo.get_name();
					if (fileName && fileName.endsWith(".desktop")) {
						const desktopFile = dir.get_child(fileName);
						const appInfo = this._parseDesktopFile(desktopFile);
						if (appInfo) {
							apps.push({
								id: fileName,
								name: appInfo.name,
							});
						}
					}
				}
				enumerator.close(null);
			} catch {
				// Skip directories that can't be read
			}
		}

		// Sort by name and remove duplicates
		apps.sort((a, b) => a.name.localeCompare(b.name));
		const seen = new Set<string>();
		return apps.filter((app) => {
			if (seen.has(app.id)) {
				return false;
			}
			seen.add(app.id);
			return true;
		});
	}

	private _parseDesktopFile(file: Gio.File): { name: string } | null {
		try {
			const [success, contents] = file.load_contents(null);
			if (!success) {
				return null;
			}

			const content = new TextDecoder("utf-8").decode(contents);
			const lines = content.split("\n");

			let inDesktopEntry = false;
			let name: string | null = null;
			let noDisplay = false;
			let hidden = false;

			for (const line of lines) {
				const trimmed = line.trim();

				if (trimmed === "[Desktop Entry]") {
					inDesktopEntry = true;
					continue;
				}

				if (trimmed.startsWith("[") && trimmed !== "[Desktop Entry]") {
					inDesktopEntry = false;
					continue;
				}

				if (!inDesktopEntry) {
					continue;
				}

				if (trimmed.startsWith("Name=") && !name) {
					name = trimmed.substring(5);
				} else if (trimmed === "NoDisplay=true") {
					noDisplay = true;
				} else if (trimmed === "Hidden=true") {
					hidden = true;
				}
			}

			if (name && !noDisplay && !hidden) {
				return { name };
			}
		} catch {
			// Ignore parse errors
		}

		return null;
	}
}
