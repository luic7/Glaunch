import Meta from "gi://Meta";
import Mtk from "gi://Mtk";
import Clutter from 'gi://Clutter';

export class AppCollection {
	private _head: App;
	private _col: App[];
	private _hIndex: number = 0;
	private _centerMouse: boolean;

	constructor(app: App, centerMouse: boolean) {
		this._head = app;
		this._col = [app];
		this._centerMouse = centerMouse;
	}

	goNext(): void {
		this._hIndex = (this._hIndex + 1) % this._col.length;
		this._head = this._col[this._hIndex];
		this._head.focus(this._centerMouse);
	}

	switchToApp(): void {
		if (!this._head) {
			console.warn('[GlaunchV2] Cannot switch to app: head is not defined');
			return;
		}
		this._head.focus(this._centerMouse);
	}

	storeApp(win: Meta.Window): void {
		if (!win || !win.is_alive) {
			console.warn('[GlaunchV2] Attempted to store an invalid window');
			return;
		}

		const index = this._col.findIndex(app => app.equals(win));
		if (index !== -1) {
			console.log(`[GlaunchV2] Window already exists in collection, switching to it instead of creating duplicate`);
			this._hIndex = index;
			this._head = this._col[this._hIndex];
			this._head.focus(this._centerMouse);
			return;
		}

		const app = new App(win);
		this._col.push(app);
		this._hIndex = this._col.length - 1;
		this._head = app;
		this._head.focus(this._centerMouse);
	}

	deleteApp(win: Meta.Window): void {
		if (!win) {
			console.warn('[GlaunchV2] Attempted to delete an invalid window');
			return;
		}

		const index = this._col.findIndex(w => w.equals(win));
		if (index === -1) {
			return;
		}

		this._col.splice(index, 1);

		if (this._col.length === 0) {
			this._hIndex = 0;
			return;
		}

		if (index <= this._hIndex) {
			this._hIndex = Math.max(0, this._hIndex - 1);
		}

		this._head = this._col[this._hIndex];
	}

	size(): number {
		return this._col.length;
	}

	setHead(win: Meta.Window): boolean {
		const index = this._col.findIndex(app => app.equals(win));
		if (index === -1) {
			return false;
		}
		this._hIndex = index;
		this._head = this._col[this._hIndex];
		return true;
	}
}

export class App {
	private _win: Meta.Window;

	constructor(win: Meta.Window) {
		this._win = win;
	}

	focus(centerMouse: boolean): void {
		if (!this._win || !this._win.is_alive) {
			console.warn('[GlaunchV2] Cannot focus: window is not valid');
			return;
		}
		this._win.raise_and_make_recent_on_workspace(this._win.get_workspace());
		if (centerMouse) {
			this._centerMouse();
		}
		this._win.focus(global.get_current_time());
	}

	equals(win: Meta.Window): boolean {
		return win === this._win;
	}

	private _centerMouse(): void {
		if (!this._win || !this._win.is_alive) {
			return;
		}

		const rect: Mtk.Rectangle = this._win.get_frame_rect();
		const x: number = rect.x + rect.width / 2;
		const y: number = rect.y + rect.height / 2;

		const seat: Clutter.Seat = Clutter.get_default_backend().get_default_seat();
		seat.warp_pointer(x, y);
	}
}
