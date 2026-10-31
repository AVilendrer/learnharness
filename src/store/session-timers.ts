import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";

function timerFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid session id");
	return path.join(PATHS.data, "session-timers", `${id}.json`);
}

export function validSessionTime(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Reads never create, migrate or rewrite a conversation or timer record. */
export function readSessionTimer(id: string): number {
	let raw: string;
	try { raw = fs.readFileSync(timerFile(id), "utf8"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
		throw error;
	}
	const record = JSON.parse(raw);
	if (record?.version !== 1 || !validSessionTime(record?.elapsedMs)) throw new Error("Unsupported or invalid session timer");
	return record.elapsedMs;
}

/** Synchronous read/atomic replace serializes writers in the app server.
 * A delayed checkpoint cannot overwrite a more recent, larger total. */
export function writeSessionTimer(id: string, elapsedMs: number): number {
	const file = timerFile(id);
	if (!validSessionTime(elapsedMs)) throw new Error("Invalid elapsed time");
	const current = readSessionTimer(id);
	const total = Math.max(current, elapsedMs);
	if (total === current) return current;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(tmp, JSON.stringify({ version: 1, elapsedMs: total }) + "\n", "utf8");
		fs.renameSync(tmp, file);
	} finally { fs.rmSync(tmp, { force: true }); }
	return total;
}
