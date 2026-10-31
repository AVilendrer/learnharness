import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionStopwatch, formatSessionTime } from "../src/core/session-stopwatch.ts";

describe("session stopwatch", () => {
	it("resets all accumulated time and stops the clock", () => {
		let now = 0;
		const timer = new SessionStopwatch(65000, () => now);
		timer.start(); now = 2000;
		timer.reset(); now = 9000;
		assert.equal(timer.elapsedMs, 0);
		assert.equal(timer.running, false);
		timer.start(); now = 10500;
		assert.equal(timer.elapsedMs, 1500);
	});
	it("counts running intervals once, excluding pauses and time before reopening", () => {
		let now = 0;
		const timer = new SessionStopwatch(0, () => now);
		assert.equal(timer.running, false);
		timer.start(); now = 1000;
		timer.start(); now = 3000;
		assert.equal(timer.elapsedMs, 3000, "starting twice must not reset the interval");
		timer.pause(); now = 20000;
		assert.equal(timer.elapsedMs, 3000);
		timer.start(); now = 22500; timer.pause();
		assert.equal(timer.elapsedMs, 5500);
		const reopened = new SessionStopwatch(timer.elapsedMs, () => now);
		now = 90000;
		assert.equal(reopened.elapsedMs, 5500);
		assert.equal(reopened.running, false);
	});
	it("keeps immediate activity while the saved total loads", () => {
		let now = 0;
		const timer = new SessionStopwatch(5000, () => now);
		timer.start(); now = 1000; timer.pause();
		timer.restore(10000);
		assert.equal(timer.elapsedMs, 11000);
		timer.restore(10000);
		assert.equal(timer.elapsedMs, 11000, "restoration is idempotent");
	});
	it("never lowers a recent local total with a stale read", () => {
		const timer = new SessionStopwatch(12000, () => 0);
		timer.restore(9000);
		assert.equal(timer.elapsedMs, 12000);
	});
	it("formats elapsed time including hours", () => {
		assert.equal(formatSessionTime(0), "0:00");
		assert.equal(formatSessionTime(65999), "1:05");
		assert.equal(formatSessionTime(3661000), "1:01:01");
	});
});
