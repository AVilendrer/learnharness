import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { parseSessionTimerState, validSessionTime, type SessionTimerState } from "../core/session-stopwatch.ts";
export { validSessionTime };

export class SessionTimerConflictError extends Error {
	constructor(readonly state: SessionTimerState) { super("Session timer changed; reload its current state"); }
}

function timerFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid session id");
	return path.join(PATHS.data, "session-timers", `${id}.json`);
}

/** Reads never create, migrate or rewrite a conversation or timer record. */
export function readSessionTimerState(id: string): SessionTimerState {
	let raw: string;
	try { raw = fs.readFileSync(timerFile(id), "utf8"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { elapsedMs: 0, generation: 0 };
		throw error;
	}
	const record = JSON.parse(raw);
	if (record?.version !== 1) throw new Error("Unsupported or invalid session timer");
	return parseSessionTimerState(record);
}

export function readSessionTimer(id: string): number { return readSessionTimerState(id).elapsedMs; }

function persist(id: string, state: SessionTimerState): void {
	const file = timerFile(id);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...state }) + "\n", "utf8");
		fs.renameSync(tmp, file);
	} finally { fs.rmSync(tmp, { force: true }); }
}

/** Synchronous read/atomic replace serializes writers in the app server.
 * A delayed checkpoint cannot overwrite a more recent, larger total. */
export function writeSessionTimer(id: string, elapsedMs: number, generation = 0): number {
	if (!validSessionTime(elapsedMs) || !validSessionTime(generation)) throw new Error("Invalid elapsed time");
	const current = readSessionTimerState(id);
	if (generation !== current.generation) throw new SessionTimerConflictError(current);
	const total = Math.max(current.elapsedMs, elapsedMs);
	if (total === current.elapsedMs) return total;
	persist(id, { elapsedMs: total, generation });
	return total;
}

export function resetSessionTimer(id: string, generation: number): SessionTimerState {
	if (!validSessionTime(generation)) throw new Error("Invalid timer generation");
	const current = readSessionTimerState(id);
	if (generation !== current.generation) throw new SessionTimerConflictError(current);
	if (generation === Number.MAX_SAFE_INTEGER) throw new Error("Timer generation limit reached");
	const next = { elapsedMs: 0, generation: generation + 1 };
	persist(id, next);
	return next;
}
