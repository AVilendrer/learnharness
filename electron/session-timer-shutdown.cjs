const { randomUUID } = require("node:crypto");

/** Keep the local server alive until the renderer's final timer checkpoint.
 * A request grants no filesystem access and accepts only its own main frame.
 * Hung/crashed renderers cannot hold the application open indefinitely. */
function installSessionTimerShutdown({ app, ipcMain, windows, stopServer, timeoutMs = 3000 }) {
	const pending = new WeakMap();
	const approved = new WeakSet();
	function flushWindow(win) {
		if (win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve();
		if (pending.has(win)) return pending.get(win);
		const contents = win.webContents;
		const id = randomUUID();
		const request = new Promise((resolve) => {
			let timeout;
			const finish = () => {
				clearTimeout(timeout);
				ipcMain.removeListener("lh:session-timer:flushed", ack);
				approved.add(win);
				resolve();
			};
			const ack = (event, received) => {
				if (event.sender === contents && event.senderFrame === contents.mainFrame && received === id) finish();
			};
			ipcMain.on("lh:session-timer:flushed", ack);
			timeout = setTimeout(finish, timeoutMs);
			try { contents.send("lh:session-timer:flush", id); } catch { finish(); }
		}).finally(() => pending.delete(win));
		pending.set(win, request);
		return request;
	}
	const flushAll = () => Promise.all([...windows()].map(flushWindow));
	let quitting = false;
	let quitApproved = false;
	app.on("before-quit", (event) => {
		if (quitApproved) return;
		event.preventDefault();
		if (quitting) return;
		quitting = true;
		void flushAll().finally(() => { quitApproved = true; stopServer(); app.quit(); });
	});
	return {
		flushAll,
		protectWindow(win) {
			let closing = false;
			win.on("close", (event) => {
				if (approved.has(win)) return;
				event.preventDefault();
				if (closing) return;
				closing = true;
				void flushWindow(win).finally(() => { if (!win.isDestroyed()) win.close(); });
			});
		},
	};
}
module.exports = { installSessionTimerShutdown };
