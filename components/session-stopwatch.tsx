"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PauseIcon, PlayIcon } from "lucide-react";
import { SessionStopwatch, formatSessionTime, bindingForAction, formatBinding, kbdEventForAction } from "@/src/core";
import { blurAfterPointerClick } from "@/components/focus-hygiene";

// Reuse the paused clock across visits, including when navigation beats the
// initial disk read. Pending activity must belong to the session, not a mount.
const sessions = new Map<string, StopwatchSession>();
let closeBridge: Window["lh"];
function ensureDesktopFlush() {
	const bridge = window.lh;
	if (!bridge?.onSessionTimerFlush || closeBridge === bridge) return;
	closeBridge = bridge;
	// This subscription lives for the renderer's lifetime. Sessions left
	// behind may still have a pending read/checkpoint when the app quits.
	bridge.onSessionTimerFlush(async () => { await Promise.allSettled([...sessions.values()].map((session) => session.flushForClose())); });
}
const emptySnapshot = { elapsedMs: 0, running: false, error: null as string | null };

class StopwatchSession {
	private readonly timer: SessionStopwatch;
	private readonly listeners = new Set<() => void>();
	private snapshot = emptySnapshot;
	private loaded = false;
	private loading: Promise<void> | null = null;
	private lastSaved = 0;
	private readonly writes = new Map<number, Promise<void>>();
	private error: string | null = null;
	constructor(private readonly chatId: string) {
		this.timer = new SessionStopwatch();
	}
	private get url() { return `/api/chats/${encodeURIComponent(this.chatId)}/timer`; }
	getSnapshot = () => this.snapshot;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	};
	private refresh = () => {
		const elapsedMs = this.timer.elapsedMs;
		if (elapsedMs === this.snapshot.elapsedMs && this.timer.running === this.snapshot.running && this.error === this.snapshot.error) return;
		this.snapshot = { elapsedMs, running: this.timer.running, error: this.error };
		for (const listener of this.listeners) listener();
	};
	start = () => { this.timer.start(); this.refresh(); };
	toggle = () => {
		if (this.timer.running) { this.timer.pause(); this.save(); }
		else this.timer.start();
		this.refresh();
	};
	private save = (): Promise<void> => {
		const elapsedMs = this.timer.elapsedMs;
		if (!this.loaded || elapsedMs <= this.lastSaved) return Promise.resolve();
		const pending = this.writes.get(elapsedMs);
		if (pending) return pending;
		const write = fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ elapsedMs }), keepalive: true,
		}).then((response) => {
			if (!response.ok) throw new Error("Could not save session time");
			this.lastSaved = Math.max(this.lastSaved, elapsedMs);
			this.error = null;
		}).catch(() => { this.error = "Could not save session time; retrying"; }).finally(() => {
			this.writes.delete(elapsedMs); this.refresh();
		});
		this.writes.set(elapsedMs, write);
		return write;
	};
	private load = () => {
		if (this.loaded || this.loading) return this.loading;
		this.loading = fetch(this.url, { cache: "no-store" }).then(async (response) => {
			if (!response.ok) throw new Error("Could not load session time");
			const record = await response.json();
			if (!Number.isSafeInteger(record?.elapsedMs) || record.elapsedMs < 0) throw new Error("Invalid session time");
			this.timer.restore(record.elapsedMs);
			this.lastSaved = record.elapsedMs;
			this.loaded = true;
			this.error = null;
			this.save();
		}).catch(() => { this.error = "Could not load session time; retrying"; }).finally(() => {
			this.loading = null;
			this.refresh();
		});
		return this.loading;
	};
	private leavePage = () => {
		this.timer.pause(); this.save(); this.refresh();
	};
	flushForClose = async () => {
		this.leavePage();
		await this.load();
		await Promise.all([...this.writes.values()]);
		await this.save();
		if (!this.loaded || this.lastSaved < this.timer.elapsedMs) throw new Error("Could not save session time");
	};
	attach = () => {
		this.load(); this.refresh();
		const paint = setInterval(this.refresh, 250);
		const checkpoint = setInterval(() => { this.load(); this.save(); }, 5000);
		const event = kbdEventForAction("toggle-session-timer");
		window.addEventListener(event, this.toggle);
		window.addEventListener("pagehide", this.leavePage);
		return () => {
			this.timer.pause(); this.save(); this.refresh();
			clearInterval(paint); clearInterval(checkpoint);
			window.removeEventListener(event, this.toggle);
			window.removeEventListener("pagehide", this.leavePage);
		};
	};
}

export function useSessionStopwatch(chatId: string) {
	const [stopwatch] = useState(() => {
		let session = sessions.get(chatId);
		if (!session) { session = new StopwatchSession(chatId); sessions.set(chatId, session); }
		return session;
	});
	const replayRunning = useRef(false);
	useEffect(() => {
		ensureDesktopFlush();
		// Only the same hook's StrictMode replay may resume. A new visit has
		// a fresh ref and restores the shared clock paused.
		if (replayRunning.current) stopwatch.start();
		const detach = stopwatch.attach();
		return () => { replayRunning.current = stopwatch.getSnapshot().running; detach(); };
	}, [stopwatch]);
	return stopwatch;
}

export function SessionStopwatchControl({ stopwatch }: { stopwatch: ReturnType<typeof useSessionStopwatch> }) {
	// Only this control subscribes to clock ticks; the conversation does not
	// rerender four times per second to update a small header readout.
	const { elapsedMs, running, error } = useSyncExternalStore(stopwatch.subscribe, stopwatch.getSnapshot, () => emptySnapshot);
	const action = running ? "Pause session stopwatch" : "Start session stopwatch";
	const shortcut = formatBinding(bindingForAction("toggle-session-timer"));
	const Icon = running ? PauseIcon : PlayIcon;
	return <div className="flex shrink-0 items-center gap-1">
		<button type="button" data-testid="session-stopwatch" aria-label={action} aria-pressed={running}
			title={`${action} (${shortcut})`} onClick={(event) => { blurAfterPointerClick(event); stopwatch.toggle(); }}
			className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 font-ui text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground">
			<Icon className="size-3" aria-hidden="true" /><span>{formatSessionTime(elapsedMs)}</span>
		</button>
		{error && <span role="status" className="text-xs text-destructive" title={error}>{error}</span>}
	</div>;
}
