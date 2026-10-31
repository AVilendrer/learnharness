import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-timer-"));
process.env.LH_DATA_DIR = root;
const { readSessionTimer, writeSessionTimer } = await import("../src/store/session-timers.ts");
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("separate session timer storage", () => {
	it("reads an old session as zero without creating files", () => {
		assert.equal(readSessionTimer("chat_old"), 0);
		assert.deepEqual(fs.readdirSync(root), []);
	});
	it("saves monotonic totals across reloads without changing learning records", () => {
		fs.mkdirSync(path.join(root, "chats")); fs.mkdirSync(path.join(root, "graph"));
		fs.writeFileSync(path.join(root, "chats", "chat_old.json"), '{"messages":[]}');
		fs.writeFileSync(path.join(root, "graph", "nodes.jsonl"), '{"id":"keep"}\n');
		assert.equal(writeSessionTimer("chat_old", 12345), 12345);
		assert.equal(writeSessionTimer("chat_old", 20000), 20000);
		assert.equal(writeSessionTimer("chat_old", 10000), 20000, "a late request cannot erase newer time");
		assert.equal(readSessionTimer("chat_old"), 20000);
		assert.equal(readSessionTimer("chat_other"), 0);
		assert.equal(fs.readFileSync(path.join(root, "chats", "chat_old.json"), "utf8"), '{"messages":[]}');
		assert.equal(fs.readFileSync(path.join(root, "graph", "nodes.jsonl"), "utf8"), '{"id":"keep"}\n');
		assert.deepEqual(fs.readdirSync(path.join(root, "session-timers")), ["chat_old.json"]);
	});
	it("rejects traversal and invalid totals before writing", () => {
		for (const id of ["../outside", "", "a/b", "a\\b"])
			assert.throws(() => writeSessionTimer(id, 1));
		for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
			assert.throws(() => writeSessionTimer("chat_bad", value));
		assert.equal(fs.existsSync(path.join(root, "session-timers", "chat_bad.json")), false);
	});
	it("refuses to overwrite malformed or future timer records", () => {
		const file = path.join(root, "session-timers", "chat_future.json");
		for (const raw of ['{"version":2,"elapsedMs":5000}', '{"version":1,"elapsedMs":-1}', 'broken']) {
			fs.writeFileSync(file, raw);
			assert.throws(() => readSessionTimer("chat_future"));
			assert.throws(() => writeSessionTimer("chat_future", 200));
			assert.equal(fs.readFileSync(file, "utf8"), raw);
		}
	});
});
