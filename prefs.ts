import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

interface ShortcutConfig {
	app: string;
	key: string;
	name: string;
}

interface DesktopApp {
	id: string;
	name: string;
	icon: Gio.Icon | null;
}

// What a function key is assigned to: an app shortcut, by its index in the
// "shortcuts" setting, or a window action, by its setting.
interface KeyOwner {
	name: string;
	shortcut?: number;
	setting?: string;
}

interface WindowActionRow {
	setting: string;
	subtitle: string;
	row: Adw.ComboRow;
	warning: Gtk.Image;
	updateKeyList: () => void;
}

const FUNCTION_KEYS = [
	"F1", "F2", "F3", "F4", "F5", "F6",
	"F7", "F8", "F9", "F10", "F11", "F12"
];

const FUNCTION_KEYS_WITH_NONE = ["None", ...FUNCTION_KEYS];

// In the order the extension binds them, after the app shortcuts.
const WINDOW_ACTIONS = [
	{
		setting: "win-prev-key",
		title: "Previous Window",
		subtitle: "Switch back to the previously focused window",
	},
	{
		setting: "win-other-key",
		title: "Cycle Other Windows",
		subtitle: "Cycle through the windows of apps without a shortcut",
	},
	{
		setting: "win-delete-key",
		title: "Close Window",
		subtitle: "Close the focused window",
	},
];

// Position of a key on the keyboard, so the shortcut list reads F1 to F12.
function keyOrder(key: string): number {
	const index = FUNCTION_KEYS.indexOf(key.toUpperCase());
	return index >= 0 ? index : FUNCTION_KEYS.length;
}

// Shortcuts saved by older versions may omit the ".desktop" suffix.
function normalizeAppId(appId: string): string {
	return appId.endsWith(".desktop") ? appId : `${appId}.desktop`;
}

// Where a shortcut is in the saved list: at the index it was read from,
// unless the list has changed since.
function findShortcut(shortcuts: ShortcutConfig[], shortcut: ShortcutConfig, index: number): number {
	const matches = (s: ShortcutConfig | undefined) => s?.app === shortcut.app && s?.key === shortcut.key;
	return matches(shortcuts[index]) ? index : shortcuts.findIndex(matches);
}

// The extension binds a key only once, for its first owner, so the others
// don't work. Returns that first owner when it isn't `self`.
function shadowingOwner(owners: KeyOwner[] | undefined, isSelf: (owner: KeyOwner) => boolean): KeyOwner | undefined {
	const first = owners?.[0];
	return first && !isSelf(first) ? first : undefined;
}

// Whatever else has a key, which makes it unavailable to `self`.
function otherOwner(owners: KeyOwner[] | undefined, isSelf: (owner: KeyOwner) => boolean): KeyOwner | undefined {
	return owners?.find((owner) => !isSelf(owner));
}

function takenMessage(key: string, owner: KeyOwner): string {
	return `${key.toUpperCase()} is already assigned to ${owner.name}`;
}

// The apps GNOME Shell knows, by ID, which are the ones a shortcut can launch.
function getInstalledApps(): Map<string, Gio.AppInfo> {
	const apps = new Map<string, Gio.AppInfo>();
	for (const info of Gio.AppInfo.get_all()) {
		const id = info.get_id();
		if (id) {
			apps.set(id, info);
		}
	}
	return apps;
}

function setAppIcon(image: Gtk.Image, icon: Gio.Icon | null): void {
	const theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default()!);
	// An icon given as a path can outlive its file.
	const usable = icon instanceof Gio.FileIcon
		? icon.get_file().query_exists(null)
		: icon !== null && theme.has_gicon(icon);
	if (usable && icon) {
		image.set_from_gicon(icon);
	} else {
		image.set_from_icon_name("application-x-executable");
	}
}

function createAppIcon(icon: Gio.Icon | null): Gtk.Image {
	// libadwaita's shadow for app icons of 32px and smaller.
	const image = new Gtk.Image({ pixelSize: 32, cssClasses: ["lowres-icon"] });
	setAppIcon(image, icon);
	return image;
}

function createKeycap(key: string): Gtk.Widget {
	return new Adw.ShortcutLabel({ accelerator: key.toUpperCase(), valign: Gtk.Align.CENTER });
}

function createWarningIcon(): Gtk.Image {
	return new Gtk.Image({ iconName: "dialog-warning-symbolic", cssClasses: ["warning"] });
}

function createEmptyRow(): Gtk.ListBoxRow {
	const box = new Gtk.Box({
		orientation: Gtk.Orientation.VERTICAL,
		spacing: 6,
		marginTop: 24,
		marginBottom: 24,
		marginStart: 12,
		marginEnd: 12,
	});
	box.append(new Gtk.Image({
		iconName: "input-keyboard-symbolic",
		pixelSize: 32,
		marginBottom: 6,
		cssClasses: ["dimmed"],
	}));
	box.append(new Gtk.Label({
		label: "No App Shortcuts",
		wrap: true,
		justify: Gtk.Justification.CENTER,
		cssClasses: ["heading"],
	}));
	box.append(new Gtk.Label({
		label: "Add a shortcut to open an app with a single key",
		wrap: true,
		justify: Gtk.Justification.CENTER,
		cssClasses: ["dimmed"],
	}));

	return new Gtk.ListBoxRow({ child: box, activatable: false, selectable: false });
}

// Shows each key of a key drop-down with what it's assigned to, and the check
// mark the default factory would draw. Keys assigned to something else can't
// be picked, so no two things share a key. Returns a function that updates
// the items, for when assignments change.
function setKeyListFactory(row: Adw.ComboRow, assignedTo: (key: string) => string | undefined): () => void {
	const factory = new Gtk.SignalListItemFactory();
	// Items are tracked from "bind" alone: "unbind" can be emitted while GJS
	// collects garbage, when JS can't run.
	const items = new Map<Gtk.ListItem, Gtk.Box>();

	const update = (listItem: Gtk.ListItem, box: Gtk.Box) => {
		const item = listItem.get_item() as Gtk.StringObject | null;
		if (!item) {
			return;
		}

		const key = item.get_string();
		const owner = key === "None" ? undefined : assignedTo(key.toLowerCase());
		const keyLabel = box.get_first_child() as Gtk.Label;
		const ownerLabel = keyLabel.get_next_sibling() as Gtk.Label;
		const check = ownerLabel.get_next_sibling() as Gtk.Image;

		keyLabel.set_label(key);
		ownerLabel.set_label(owner ?? "");
		box.set_sensitive(owner === undefined);
		listItem.set_activatable(owner === undefined);
		listItem.set_selectable(owner === undefined);
		check.set_opacity(item === row.get_selected_item() ? 1 : 0);
	};
	const updateAll = () => {
		for (const [listItem, box] of items) {
			update(listItem, box);
		}
	};

	factory.connect("setup", (_factory, object) => {
		const box = new Gtk.Box({ spacing: 12 });
		box.append(new Gtk.Label({ xalign: 0 }));
		box.append(new Gtk.Label({
			xalign: 1,
			hexpand: true,
			ellipsize: Pango.EllipsizeMode.END,
			maxWidthChars: 20,
			cssClasses: ["dimmed"],
		}));
		box.append(new Gtk.Image({ iconName: "object-select-symbolic" }));
		(object as Gtk.ListItem).set_child(box);
	});

	factory.connect("bind", (_factory, object) => {
		const listItem = object as Gtk.ListItem;
		const box = listItem.get_child() as Gtk.Box;
		items.set(listItem, box);
		update(listItem, box);
	});

	row.set_expression(Gtk.PropertyExpression.new(Gtk.StringObject.$gtype, null, "string"));
	row.set_list_factory(factory);
	row.connect("notify::selected-item", updateAll);
	return updateAll;
}

export default class GlaunchPreferences extends ExtensionPreferences {
	private _settings: Gio.Settings | null = null;
	private _window: Adw.PreferencesWindow | null = null;
	private _keyOwners = new Map<string, KeyOwner[]>();
	private _shortcutList: Gtk.ListBox | null = null;
	private _shortcutRows: Gtk.ListBoxRow[] = [];
	private _shortcutRowsByIndex = new Map<number, Adw.ActionRow>();
	private _addRow: Adw.ButtonRow | null = null;
	private _windowRows: WindowActionRow[] = [];
	private _undoToast: Adw.Toast | null = null;

	fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
		this._settings = this.getSettings();
		this._window = window;

		const page = new Adw.PreferencesPage({
			title: "Shortcuts",
			iconName: "preferences-desktop-keyboard-shortcuts-symbolic",
		});

		page.add(this._createShortcutsGroup());
		page.add(this._createWindowManagementGroup());

		// Applies to every window switch, not just the keys above, so it gets
		// its own group like the Super key switch in Settings.
		const centerMouseRow = new Adw.SwitchRow({
			title: "Center Pointer on Focus",
			subtitle: "Move the pointer to the center of a window when switching to it or toggling its maximization",
		});
		this._settings.bind("win-center-mouse", centerMouseRow, "active", Gio.SettingsBindFlags.DEFAULT);
		const centerMouseGroup = new Adw.PreferencesGroup();
		centerMouseGroup.add(centerMouseRow);
		page.add(centerMouseGroup);

		window.add(page);
		this._refresh();

		// The default size cuts off the last options, so grow the window to fit
		// the page. GTK still keeps it within the screen, and the page scrolls
		// when there are too many shortcuts.
		const [width, height] = window.get_default_size();
		const [, naturalHeight] = window.measure(Gtk.Orientation.VERTICAL, width);
		window.set_default_size(width, Math.max(height, naturalHeight));

		window.connect('close-request', () => {
			this._settings = null;
		});

		return Promise.resolve();
	}

	// Updates everything that depends on the settings: the shortcut rows, and
	// which keys are taken, and by what.
	private _refresh(): void {
		const shortcuts = this._getShortcuts();
		this._keyOwners = this._getKeyOwners(shortcuts);
		this._refreshShortcutList(shortcuts, getInstalledApps());
		this._refreshWindowRows();
	}

	// The owners of each key, in the order the extension binds them: app
	// shortcuts in their saved order, then window actions.
	private _getKeyOwners(shortcuts: ShortcutConfig[]): Map<string, KeyOwner[]> {
		const owners = new Map<string, KeyOwner[]>();
		const add = (key: string, owner: KeyOwner) => {
			const k = key.toLowerCase();
			owners.set(k, [...(owners.get(k) ?? []), owner]);
		};

		shortcuts.forEach((shortcut, index) => {
			add(shortcut.key, { name: shortcut.name || shortcut.app, shortcut: index });
		});
		for (const action of WINDOW_ACTIONS) {
			const key = this._settings?.get_string(action.setting) ?? "";
			if (key) {
				add(key, { name: action.title, setting: action.setting });
			}
		}

		return owners;
	}

	private _createShortcutsGroup(): Adw.PreferencesGroup {
		const group = new Adw.PreferencesGroup({
			title: "App Shortcuts",
			description: "Press a key to open its app, switch to it, or cycle through its windows",
		});

		// A list of our own rather than the group's, so the add row can stay last
		// as rows come and go.
		this._shortcutList = new Gtk.ListBox({
			selectionMode: Gtk.SelectionMode.NONE,
			cssClasses: ["boxed-list"],
		});
		this._addRow = new Adw.ButtonRow({
			title: "_Add Shortcut…",
			useUnderline: true,
			startIconName: "list-add-symbolic",
		});
		this._addRow.connect("activated", () => {
			this._showShortcutDialog();
		});
		this._shortcutList.append(this._addRow);
		group.add(this._shortcutList);

		return group;
	}

	private _refreshShortcutList(shortcuts: ShortcutConfig[], installed: Map<string, Gio.AppInfo>): void {
		if (!this._shortcutList) {
			return;
		}

		for (const row of this._shortcutRows) {
			this._shortcutList.remove(row);
		}
		this._shortcutRowsByIndex.clear();

		this._shortcutRows = shortcuts
			.map((shortcut, index) => ({ shortcut, index }))
			.sort((a, b) => keyOrder(a.shortcut.key) - keyOrder(b.shortcut.key))
			.map(({ shortcut, index }) => {
				const row = this._createShortcutRow(shortcut, index, installed);
				this._shortcutRowsByIndex.set(index, row);
				return row;
			});
		if (this._shortcutRows.length === 0) {
			this._shortcutRows.push(createEmptyRow());
		}
		this._shortcutRows.forEach((row, position) => this._shortcutList?.insert(row, position));
	}

	private _createShortcutRow(
		shortcut: ShortcutConfig,
		index: number,
		installed: Map<string, Gio.AppInfo>
	): Adw.ActionRow {
		const appInfo = installed.get(normalizeAppId(shortcut.app));
		const takenBy = shadowingOwner(
			this._keyOwners.get(shortcut.key.toLowerCase()),
			(owner) => owner.shortcut === index
		);
		let problem = "";
		if (!appInfo) {
			problem = "Not installed";
		} else if (takenBy) {
			problem = takenMessage(shortcut.key, takenBy);
		}

		const row = new Adw.ActionRow({
			title: shortcut.name || shortcut.app,
			subtitle: problem,
			useMarkup: false,
			activatable: true,
		});
		row.add_prefix(createAppIcon(appInfo?.get_icon() ?? null));
		if (problem) {
			row.add_suffix(createWarningIcon());
		}
		row.add_suffix(createKeycap(shortcut.key));
		// Rows open their editor, which Settings marks the same way.
		row.add_suffix(new Gtk.Image({ iconName: "document-edit-symbolic", marginStart: 6 }));
		row.connect("activated", () => {
			this._showShortcutDialog(index);
		});

		return row;
	}

	private _createWindowManagementGroup(): Adw.PreferencesGroup {
		const group = new Adw.PreferencesGroup({
			title: "Window Management",
		});

		for (const action of WINDOW_ACTIONS) {
			const row = new Adw.ComboRow({
				title: action.title,
				subtitle: action.subtitle,
				useMarkup: false,
				model: Gtk.StringList.new(FUNCTION_KEYS_WITH_NONE),
			});
			// Added, with an explanation as the subtitle, when this row's key goes
			// to an app shortcut or an earlier window action.
			const warning = createWarningIcon();

			const isSelf = (owner: KeyOwner) => owner.setting === action.setting;
			const updateKeyList = setKeyListFactory(
				row,
				(key) => otherOwner(this._keyOwners.get(key), isSelf)?.name
			);

			this._setComboFromSetting(row, action.setting);
			row.connect("notify::selected", () => {
				this._saveKeyFromCombo(row, action.setting);
				this._dismissUndo();
				this._refresh();
			});

			this._windowRows.push({ setting: action.setting, subtitle: action.subtitle, row, warning, updateKeyList });
			group.add(row);
		}

		return group;
	}

	private _refreshWindowRows(): void {
		for (const { setting, subtitle, row, warning, updateKeyList } of this._windowRows) {
			const key = this._settings?.get_string(setting).toLowerCase() ?? "";
			const takenBy = key
				? shadowingOwner(this._keyOwners.get(key), (owner) => owner.setting === setting)
				: undefined;

			row.set_subtitle(takenBy ? takenMessage(key, takenBy) : subtitle);
			// Rows keep space for a prefix even when it's hidden, so add and remove it.
			if (takenBy && !warning.get_parent()) {
				row.add_prefix(warning);
			} else if (!takenBy && warning.get_parent()) {
				row.remove(warning);
			}
			updateKeyList();
		}
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

	private _removeShortcut(shortcut: ShortcutConfig, savedIndex: number): void {
		const shortcuts = this._getShortcuts();
		const index = findShortcut(shortcuts, shortcut, savedIndex);
		if (index < 0) {
			return;
		}

		const [removed] = shortcuts.splice(index, 1);
		this._saveShortcuts(shortcuts);
		this._dismissUndo();
		this._refresh();

		// The HIG prefers undo to asking for confirmation.
		const toast = new Adw.Toast({
			title: `${removed.name || removed.app} shortcut removed`,
			buttonLabel: "_Undo",
			useMarkup: false,
		});
		toast.connect("button-clicked", () => {
			const current = this._getShortcuts();
			current.splice(Math.min(index, current.length), 0, removed);
			this._saveShortcuts(current);
			this._refresh();
		});
		this._undoToast = toast;
		this._window?.add_toast(toast);
	}

	// Undo can only put a shortcut back while nothing else has changed since,
	// or its key could have been reassigned.
	private _dismissUndo(): void {
		this._undoToast?.dismiss();
		this._undoToast = null;
	}

	// Add Shortcut, or Edit Shortcut when given a shortcut's index: a form like
	// the custom shortcut dialog in Settings.
	private _showShortcutDialog(index?: number): void {
		const shortcuts = this._getShortcuts();
		const editIndex = index ?? -1;
		const editing = index !== undefined ? shortcuts[index] : undefined;
		const owners = this._getKeyOwners(shortcuts);
		const keyOwner = (key: string) => otherOwner(owners.get(key), (owner) => owner.shortcut === editIndex);
		const installed = getInstalledApps();
		const apps = this._getDesktopApps();

		let selectedApp: DesktopApp | null = null;
		if (editing) {
			const id = normalizeAppId(editing.app);
			selectedApp = {
				id,
				name: editing.name || editing.app,
				icon: apps.find((app) => app.id === id)?.icon ?? installed.get(id)?.get_icon() ?? null,
			};
		}
		let appChanged = false;
		// Where keyboard focus goes once the dialog is closed, when the row it
		// was opened from has been rebuilt or removed.
		let focusAfterClose: (() => Gtk.Widget | null | undefined) | null = null;

		const dialog = new Adw.Dialog({
			title: editing ? "Edit Shortcut" : "Add Shortcut",
			contentWidth: 420,
			contentHeight: 440,
		});
		const navigationView = new Adw.NavigationView();
		dialog.set_child(navigationView);

		const cancelButton = new Gtk.Button({ label: "_Cancel", useUnderline: true });
		cancelButton.connect("clicked", () => {
			dialog.close();
		});

		const confirmButton = new Gtk.Button({
			label: editing ? "_Save" : "_Add",
			useUnderline: true,
			sensitive: false,
		});
		// Added rather than set, which would drop the classes buttons and rows
		// give themselves.
		confirmButton.add_css_class("suggested-action");

		const buttonSizeGroup = new Gtk.SizeGroup({ mode: Gtk.SizeGroupMode.HORIZONTAL });
		buttonSizeGroup.add_widget(cancelButton);
		buttonSizeGroup.add_widget(confirmButton);

		const headerBar = new Adw.HeaderBar({
			showStartTitleButtons: false,
			showEndTitleButtons: false,
		});
		headerBar.pack_start(cancelButton);
		headerBar.pack_end(confirmButton);

		// Empty until an app is chosen, like the Shortcut row in Settings.
		const appIcon = new Gtk.Image({ pixelSize: 24, cssClasses: ["lowres-icon"] });
		const appLabel = new Gtk.Label({ ellipsize: Pango.EllipsizeMode.END, maxWidthChars: 24 });
		// Alt+P, since Alt+A belongs to the Add button.
		const appRow = new Adw.ActionRow({ title: "A_pp", useUnderline: true, activatable: true });
		appRow.add_suffix(appIcon);
		appRow.add_suffix(appLabel);
		appRow.add_suffix(new Gtk.Image({ iconName: "go-next-symbolic" }));
		const showApp = () => {
			appIcon.set_visible(selectedApp !== null);
			setAppIcon(appIcon, selectedApp?.icon ?? null);
			appLabel.set_label(selectedApp?.name ?? "");
			appRow.set_subtitle(selectedApp && !installed.has(selectedApp.id) ? "Not installed" : "");
		};
		showApp();

		const keyRow = new Adw.ComboRow({
			title: "_Key",
			useUnderline: true,
			model: Gtk.StringList.new(FUNCTION_KEYS),
		});
		setKeyListFactory(keyRow, (key) => keyOwner(key)?.name);
		// A new shortcut starts on a free key, so the dialog doesn't open with an
		// error.
		const currentKey = editing ? FUNCTION_KEYS.indexOf(editing.key.toUpperCase()) : -1;
		const firstFreeKey = FUNCTION_KEYS.findIndex((key) => !keyOwner(key.toLowerCase()));
		keyRow.set_selected(Math.max(currentKey >= 0 ? currentKey : firstFreeKey, 0));

		// Inline error, as Settings shows conflicts instead of an alert.
		const errorLabel = new Gtk.Label({
			wrap: true,
			xalign: 0,
			hexpand: true,
			cssClasses: ["caption"],
		});
		const errorBox = new Gtk.Box({ spacing: 6, marginTop: 12, visible: false });
		errorBox.append(new Gtk.Image({ iconName: "dialog-error-symbolic", cssClasses: ["error"] }));
		errorBox.append(errorLabel);

		const formGroup = new Adw.PreferencesGroup();
		formGroup.add(appRow);
		formGroup.add(keyRow);
		formGroup.add(errorBox);

		const formContent = new Adw.PreferencesPage();
		formContent.add(formGroup);

		if (editing) {
			const removeRow = new Adw.ButtonRow({ title: "_Remove Shortcut", useUnderline: true });
			removeRow.add_css_class("destructive-action");
			removeRow.connect("activated", () => {
				this._removeShortcut(editing, editIndex);
				focusAfterClose = () => this._addRow;
				dialog.close();
			});
			const removeGroup = new Adw.PreferencesGroup();
			removeGroup.add(removeRow);
			formContent.add(removeGroup);
		}

		const formToolbarView = new Adw.ToolbarView({ content: formContent });
		formToolbarView.add_top_bar(headerBar);
		navigationView.push(new Adw.NavigationPage({ title: dialog.title, child: formToolbarView }));

		const selectedKey = () => FUNCTION_KEYS[keyRow.get_selected()].toLowerCase();
		const validate = () => {
			const owner = keyOwner(selectedKey());
			if (FUNCTION_KEYS.every((key) => keyOwner(key.toLowerCase()))) {
				errorLabel.set_label("Every function key is already assigned");
			} else {
				errorLabel.set_label(owner ? takenMessage(selectedKey(), owner) : "");
			}
			errorBox.set_visible(owner !== undefined);
			confirmButton.set_sensitive(selectedApp !== null && owner === undefined);
		};
		keyRow.connect("notify::selected", validate);

		const appPage = this._createAppPage(apps, selectedApp?.id ?? null, (app) => {
			selectedApp = app;
			appChanged = !editing || app.id !== normalizeAppId(editing.app);
			showApp();
			validate();
			navigationView.pop();
		});
		navigationView.add(appPage);
		appRow.connect("activated", () => {
			navigationView.push(appPage);
		});

		confirmButton.connect("clicked", () => {
			if (!selectedApp) {
				return;
			}

			const key = selectedKey();
			const current = this._getShortcuts();
			let position = current.length;

			if (!editing) {
				// Check for duplicate key
				if (this._getKeyOwners(current).has(key)) {
					validate();
					return;
				}

				current.push({
					app: selectedApp.id,
					key,
					name: selectedApp.name,
				});
			} else {
				position = findShortcut(current, editing, editIndex);
				if (position < 0 || (!appChanged && key === editing.key.toLowerCase())) {
					dialog.close();
					return;
				}

				if (otherOwner(this._getKeyOwners(current).get(key), (owner) => owner.shortcut === position)) {
					validate();
					return;
				}

				current[position] = appChanged
					? { app: selectedApp.id, key, name: selectedApp.name }
					: { ...editing, key };
			}

			this._saveShortcuts(current);
			this._dismissUndo();
			this._refresh();
			focusAfterClose = () => this._shortcutRowsByIndex.get(position);
			dialog.close();
		});

		dialog.connect("closed", () => {
			focusAfterClose?.()?.grab_focus();
		});

		validate();
		dialog.set_default_widget(confirmButton);
		dialog.set_focus(appRow);
		dialog.present(this._window);
	}

	// A searchable list of apps, like the Add Input Source dialog in Settings.
	private _createAppPage(
		apps: DesktopApp[],
		selectedId: string | null,
		onChoose: (app: DesktopApp) => void
	): Adw.NavigationPage {
		const searchEntry = new Gtk.SearchEntry({
			placeholderText: "Search apps",
			hexpand: true,
		});
		const searchBar = new Gtk.SearchBar({ child: searchEntry, searchModeEnabled: true });

		const appList = new Gtk.ListBox({
			selectionMode: Gtk.SelectionMode.NONE,
			cssClasses: ["boxed-list"],
		});
		appList.set_placeholder(new Gtk.Label({
			label: "No apps found",
			marginTop: 18,
			marginBottom: 18,
			cssClasses: ["dimmed"],
		}));

		const nameCounts = new Map<string, number>();
		for (const app of apps) {
			nameCounts.set(app.name, (nameCounts.get(app.name) ?? 0) + 1);
		}

		const appsByRow = new Map<Gtk.ListBoxRow, DesktopApp>();
		const checks = new Map<string, Gtk.Image>();
		for (const app of apps) {
			const row = new Adw.ActionRow({
				title: app.name,
				// Tells apart apps that share a name, like a snap and a deb of one app.
				subtitle: (nameCounts.get(app.name) ?? 0) > 1 ? app.id : "",
				useMarkup: false,
				activatable: true,
			});
			row.add_prefix(createAppIcon(app.icon));
			const check = new Gtk.Image({ iconName: "object-select-symbolic", visible: app.id === selectedId });
			row.add_suffix(check);
			appList.append(row);
			appsByRow.set(row, app);
			checks.set(app.id, check);
		}

		const searchText = () => searchEntry.get_text().trim().toLowerCase();
		const matchesSearch = (app: DesktopApp) => app.name.toLowerCase().includes(searchText());
		appList.set_filter_func((row) => matchesSearch(appsByRow.get(row)!));
		searchEntry.connect("search-changed", () => {
			appList.invalidate_filter();
		});

		const choose = (app: DesktopApp) => {
			for (const [id, check] of checks) {
				check.set_visible(id === app.id);
			}
			onChoose(app);
		};
		appList.connect("row-activated", (_list, row) => {
			choose(appsByRow.get(row)!);
		});
		// Enter picks the first match, so typing a name and pressing Enter is enough.
		searchEntry.connect("activate", () => {
			const firstMatch = searchText() ? apps.find(matchesSearch) : undefined;
			if (firstMatch) {
				choose(firstMatch);
			}
		});

		const appGroup = new Adw.PreferencesGroup();
		appGroup.add(appList);
		const appContent = new Adw.PreferencesPage();
		appContent.add(appGroup);

		const toolbarView = new Adw.ToolbarView({ content: appContent });
		toolbarView.add_top_bar(new Adw.HeaderBar({ showEndTitleButtons: false }));
		toolbarView.add_top_bar(searchBar);

		const page = new Adw.NavigationPage({ title: "Choose App", child: toolbarView });
		searchBar.set_key_capture_widget(page);
		page.connect("shown", () => {
			searchEntry.grab_focus();
		});
		return page;
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
								icon: this._iconFromString(appInfo.icon),
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

	private _iconFromString(icon: string | null): Gio.Icon | null {
		if (!icon) {
			return null;
		}

		try {
			return Gio.Icon.new_for_string(icon);
		} catch {
			return null;
		}
	}

	private _parseDesktopFile(file: Gio.File): { name: string; icon: string | null } | null {
		try {
			const [success, contents] = file.load_contents(null);
			if (!success) {
				return null;
			}

			const content = new TextDecoder("utf-8").decode(contents);
			const lines = content.split("\n");

			let inDesktopEntry = false;
			let name: string | null = null;
			let icon: string | null = null;
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
				} else if (trimmed.startsWith("Icon=") && !icon) {
					icon = trimmed.substring(5);
				} else if (trimmed === "NoDisplay=true") {
					noDisplay = true;
				} else if (trimmed === "Hidden=true") {
					hidden = true;
				}
			}

			if (name && !noDisplay && !hidden) {
				return { name, icon };
			}
		} catch {
			// Ignore parse errors
		}

		return null;
	}
}
