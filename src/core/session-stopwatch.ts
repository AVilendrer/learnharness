/** Accumulated session time. Only running intervals advance the clock. */
export class SessionStopwatch {
	private accrued = 0;
	private startedAt: number | null = null;
	constructor(private savedTotal = 0, private readonly now: () => number = () => performance.now()) {}
	get running(): boolean { return this.startedAt !== null; }
	get elapsedMs(): number {
		return Math.floor(this.savedTotal + this.accrued + (this.startedAt === null ? 0 : Math.max(0, this.now() - this.startedAt)));
	}
	start(): void { if (this.startedAt === null) this.startedAt = this.now(); }
	pause(): void {
		if (this.startedAt === null) return;
		this.accrued += Math.max(0, this.now() - this.startedAt);
		this.startedAt = null;
	}
	/** Merge the initial read without losing activity during its request. */
	restore(elapsedMs: number): void { this.savedTotal = Math.max(this.savedTotal, elapsedMs); }
}

export function formatSessionTime(elapsedMs: number): string {
	const seconds = Math.floor(elapsedMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const tail = `${minutes % 60}`.padStart(2, "0") + ":" + `${seconds % 60}`.padStart(2, "0");
	return minutes >= 60 ? `${Math.floor(minutes / 60)}:${tail}` : `${minutes}:${`${seconds % 60}`.padStart(2, "0")}`;
}
