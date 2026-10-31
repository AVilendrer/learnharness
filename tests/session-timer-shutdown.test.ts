import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url);
const { installSessionTimerShutdown } = require("../electron/session-timer-shutdown.cjs");

function fixture() {
	const app = new EventEmitter() as EventEmitter & { quit(): void };
	const ipcMain = new EventEmitter();
	const win = new EventEmitter() as EventEmitter & { webContents: unknown; isDestroyed(): boolean; close(): void };
	const events: string[] = [];
	let requestId = "";
	const mainFrame = {};
	const contents = { mainFrame, isDestroyed: () => false, send: (_channel: string, id: string) => { requestId = id; events.push("flush"); } };
	Object.assign(win, { webContents: contents, isDestroyed: () => false, close: () => events.push("closed") });
	Object.assign(app, { quit: () => { events.push("quit"); app.emit("before-quit", { preventDefault() { events.push("prevent"); } }); } });
	const guard = installSessionTimerShutdown({ app, ipcMain, windows: () => [win], stopServer: () => events.push("stop"), timeoutMs: 50 });
	guard.protectWindow(win);
	return { app, ipcMain, win, contents, events, ack: (sender = contents, senderFrame = mainFrame) => ipcMain.emit("lh:session-timer:flushed", { sender, senderFrame }, requestId) };
}

it("keeps the server alive until the trusted main frame has flushed, then quits once", async () => {
	const f = fixture();
	f.app.emit("before-quit", { preventDefault() { f.events.push("prevent"); } });
	assert.deepEqual(f.events, ["prevent", "flush"]);
	f.ack({} as typeof f.contents);
	f.ack(f.contents, {});
	await Promise.resolve();
	assert.equal(f.events.includes("stop"), false, "foreign senders and subframes cannot authorize shutdown");
	f.ack();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(f.events, ["prevent", "flush", "stop", "quit"]);
	assert.equal(f.ipcMain.listenerCount("lh:session-timer:flushed"), 0);
});

it("holds an ordinary window close until persistence completes", async () => {
	const f = fixture();
	f.win.emit("close", { preventDefault() { f.events.push("prevent"); } });
	assert.deepEqual(f.events, ["prevent", "flush"]);
	f.ack();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(f.events, ["prevent", "flush", "closed"]);
});

it("bounds a hung renderer without leaking IPC listeners", async () => {
	const f = fixture();
	f.app.emit("before-quit", { preventDefault() {} });
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.ok(f.events.includes("quit"));
	assert.equal(f.ipcMain.listenerCount("lh:session-timer:flushed"), 0);
});

it("the preload acknowledges only after the registered renderer flush resolves", async () => {
	let bridge!: { onSessionTimerFlush(cb: () => Promise<void>): () => void };
	let listener!: (event: unknown, id: string) => Promise<void>;
	const sent: string[] = [];
	runInNewContext(readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8"), {
		process: { platform: "win32" },
		require: () => ({ contextBridge: { exposeInMainWorld: (_: string, api: typeof bridge) => { bridge = api; } },
			ipcRenderer: { on: (channel: string, cb: typeof listener) => { if (channel === "lh:session-timer:flush") listener = cb; },
				send: (_channel: string, id: string) => sent.push(id) } }),
	});
	let finish!: () => void;
	const off = bridge.onSessionTimerFlush(() => new Promise<void>((resolve) => { finish = resolve; }));
	const waiting = listener({}, "request1");
	assert.deepEqual(sent, []);
	finish(); await waiting;
	assert.deepEqual(sent, ["request1"]);
	off(); await listener({}, "request2");
	assert.deepEqual(sent, ["request1", "request2"], "non-session screens close without waiting for a missing stopwatch");
});
