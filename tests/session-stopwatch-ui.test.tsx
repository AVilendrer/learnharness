import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
import assert from "node:assert/strict";
import { afterEach, beforeEach, it, mock } from "node:test";
import { parseHTML } from "linkedom";
import type { Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SessionStopwatchControl, useSessionStopwatch } from "../components/session-stopwatch.tsx";
import { KeyboardShortcuts } from "../components/keyboard-shortcuts.tsx";

const { window, document } = parseHTML("<html><body></body></html>");
const overrides = new Map<string, string>();
Object.assign(window, { localStorage: { getItem: (k: string) => overrides.get(k) ?? null } });
Object.assign(globalThis, { window, document, CustomEvent: window.CustomEvent });
const realFetch = globalThis.fetch;
let now = 0;
let seq = 0;
let saved = 0;
let posts: { total: number; keepalive: boolean | undefined }[];
const roots: { root: Root; host: HTMLElement }[] = [];

beforeEach(() => {
	now = 0; saved = 65000; posts = []; overrides.clear();
	mock.method(performance, "now", () => now);
	mock.timers.enable({ apis: ["setInterval"] });
	globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
		if (init?.method === "POST") {
			const total = JSON.parse(String(init.body)).elapsedMs;
			posts.push({ total, keepalive: init.keepalive }); saved = Math.max(saved, total);
		}
		return Response.json({ elapsedMs: saved });
	}) as typeof fetch;
});
afterEach(async () => {
	for (const { root, host } of roots.splice(0)) {
		await act(async () => { root.unmount(); }); host.remove();
	}
	globalThis.fetch = realFetch;
	delete window.lh;
	mock.restoreAll(); mock.timers.reset();
});

function Harness({ id }: { id: string }) {
	const timer = useSessionStopwatch(id);
	return <><SessionStopwatchControl stopwatch={timer} /><button data-submit onClick={timer.start}>Submit</button><textarea /></>;
}
async function mount(id = `timer_ui_${seq++}`, strict = false) {
	const host = document.createElement("div") as unknown as HTMLElement;
	document.body.append(host);
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(host); roots.push({ root, host });
	const content = <AppRouterContext.Provider value={{ push() {} } as never}><KeyboardShortcuts /><Harness id={id} /></AppRouterContext.Provider>;
	await act(async () => { root.render(strict ? <React.StrictMode>{content}</React.StrictMode> : content); });
	return { root, host, id };
}
function control(host: HTMLElement) { return host.querySelector<HTMLButtonElement>('[data-testid="session-stopwatch"]')!; }
async function press(target: Element | typeof window, key: string, extra = {}) {
	await act(async () => { target.dispatchEvent(Object.assign(new window.Event("keydown", { bubbles: true, cancelable: true }), {
		key, code: `Key${key.toUpperCase()}`, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra,
	})); });
}

it("restores paused, protects typing, toggles once per key press and honors a custom binding", async () => {
	const { host } = await mount();
	// A native field outside React's root exercises the window dispatcher's
	// typing guard without linkedom's incomplete React input-event polyfill.
	const field = document.createElement("textarea"); document.body.append(field);
	assert.ok(control(host).textContent!.includes("1:05"));
	assert.equal(control(host).getAttribute("aria-pressed"), "false");
	await press(field, "p");
	assert.equal(control(host).getAttribute("aria-pressed"), "false");
	await press(window, "p");
	assert.equal(control(host).getAttribute("aria-pressed"), "true");
	await press(window, "p", { repeat: true });
	assert.equal(control(host).getAttribute("aria-pressed"), "true");
	now = 2000;
	await press(window, "p");
	assert.ok(control(host).textContent!.includes("1:07"));
	assert.equal(saved, 67000);
	overrides.set("lh:keymap", JSON.stringify({ "toggle-session-timer": "mod+shift+y" }));
	await press(window, "p");
	assert.equal(control(host).getAttribute("aria-pressed"), "false");
	await press(field, "y", { ctrlKey: true, shiftKey: true });
	assert.equal(control(host).getAttribute("aria-pressed"), "true");
	field.remove();
});

it("resumes on submit, checkpoints and pauses on pagehide without counting closed time", async () => {
	const { host } = await mount();
	await act(async () => { host.querySelector<HTMLButtonElement>("[data-submit]")!.click(); });
	now = 5000;
	await act(async () => { mock.timers.tick(5000); });
	assert.equal(saved, 70000);
	now = 6500;
	await act(async () => { window.dispatchEvent(new window.Event("pagehide")); });
	assert.equal(saved, 71500);
	assert.equal(control(host).getAttribute("aria-pressed"), "false");
	assert.equal(posts.at(-1)?.keepalive, true);
	now = 100000;
	await act(async () => { mock.timers.tick(5000); });
	assert.equal(saved, 71500);
});

it("preserves elapsed time across immediate unmount/re-entry and StrictMode effects", async () => {
	const first = await mount(undefined, true);
	await act(async () => { control(first.host).click(); });
	now = 3500;
	await act(async () => { first.root.unmount(); });
	assert.equal(saved, 68500);
	now = 9000;
	const second = await mount(first.id);
	assert.ok(control(second.host).textContent!.includes("1:08"));
	assert.equal(control(second.host).getAttribute("aria-pressed"), "false");
});

it("preserves a submission made before the saved total arrives", async () => {
	let resolve!: (response: Response) => void;
	globalThis.fetch = ((_url: unknown, init?: RequestInit) => init?.method === "POST"
		? Promise.resolve(Response.json({ elapsedMs: JSON.parse(String(init.body)).elapsedMs }))
		: new Promise<Response>((done) => { resolve = done; })) as typeof fetch;
	const { host } = await mount();
	await act(async () => { host.querySelector<HTMLButtonElement>("[data-submit]")!.click(); });
	now = 2500;
	await act(async () => { resolve(Response.json({ elapsedMs: 10000 })); });
	assert.ok(control(host).textContent!.includes("0:12"));
	assert.equal(control(host).getAttribute("aria-pressed"), "true");
});

it("adds both visits when navigation happens before the initial read resolves", async () => {
	const reads: ((response: Response) => void)[] = [];
	let total = 100000;
	globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
		if (init?.method === "POST") {
			total = Math.max(total, JSON.parse(String(init.body)).elapsedMs);
			return Promise.resolve(Response.json({ elapsedMs: total }));
		}
		return new Promise<Response>((resolve) => { reads.push(resolve); });
	}) as typeof fetch;
	const first = await mount();
	await act(async () => { control(first.host).click(); });
	now = 5000;
	await act(async () => { first.root.unmount(); });
	const second = await mount(first.id);
	assert.equal(control(second.host).getAttribute("aria-pressed"), "false");
	await act(async () => { control(second.host).click(); });
	now = 12000;
	await act(async () => { for (const resolve of reads) resolve(Response.json({ elapsedMs: 100000 })); });
	await act(async () => { control(second.host).click(); });
	assert.equal(total, 112000, "both five- and seven-second visits must be retained");
});

it("acknowledges desktop close only after the final checkpoint finishes", async () => {
	let flush!: () => Promise<void>;
	let finish!: (response: Response) => void;
	window.lh = { expandWindow() {}, onSessionTimerFlush: (callback: () => Promise<void>) => { flush = callback; return () => {}; } };
	const { host } = await mount();
	globalThis.fetch = (() => new Promise<Response>((resolve) => { finish = resolve; })) as typeof fetch;
	await act(async () => { control(host).click(); });
	now = 2300;
	let acknowledged = false;
	let pending!: Promise<void>;
	await act(async () => { pending = flush().then(() => { acknowledged = true; }); });
	assert.equal(acknowledged, false);
	assert.equal(control(host).getAttribute("aria-pressed"), "false");
	await act(async () => { finish(Response.json({ elapsedMs: 67300 })); await pending; });
	assert.equal(acknowledged, true);
});

it("desktop close also waits for the save from a session that has been left", async () => {
	let flush!: () => Promise<void>;
	let finish!: (response: Response) => void;
	window.lh = { expandWindow() {}, onSessionTimerFlush: (callback: () => Promise<void>) => { flush = callback; return () => { flush = async () => {}; }; } };
	const first = await mount();
	await act(async () => { control(first.host).click(); });
	globalThis.fetch = (() => new Promise<Response>((resolve) => { finish = resolve; })) as typeof fetch;
	now = 1700;
	await act(async () => { first.root.unmount(); });
	let acknowledged = false;
	const pending = flush().then(() => { acknowledged = true; });
	await Promise.resolve();
	assert.equal(acknowledged, false, "leaving the session must not detach its outstanding save from desktop shutdown");
	finish(Response.json({ elapsedMs: 66700 }));
	await pending;
	assert.equal(acknowledged, true);
});

it("shows load failures and never overwrites an unreadable saved timer", async () => {
	globalThis.fetch = (async () => new Response("broken", { status: 500 })) as typeof fetch;
	const { host } = await mount();
	assert.match(host.textContent!, /Could not load session time/);
	await act(async () => { control(host).click(); now = 4000; control(host).click(); });
	assert.equal(posts.length, 0);
});

it("a failed old timer cannot acknowledge close before a healthy timer finishes saving", async () => {
	let flush!: () => Promise<void>;
	let finish!: (response: Response) => void;
	window.lh = { expandWindow() {}, onSessionTimerFlush: (callback: () => Promise<void>) => { flush = callback; return () => {}; } };
	const current = await mount();
	await act(async () => { control(current.host).click(); });
	globalThis.fetch = ((_url: unknown, init?: RequestInit) => init?.method === "POST"
		? new Promise<Response>((resolve) => { finish = resolve; })
		: Promise.resolve(new Response("unreadable prior session timer", { status: 500 }))) as typeof fetch;
	now = 1200;
	let acknowledged = false;
	const closing = flush().then(() => { acknowledged = true; }, () => { acknowledged = true; });
	// Let the old failed timer's retry and rejected flush settle.
	await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
	assert.equal(acknowledged, false);
	finish(Response.json({ elapsedMs: 66200 }));
	await closing;
	assert.equal(acknowledged, true);
});
