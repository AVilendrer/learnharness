import { getChat, readSessionTimerState, writeSessionTimer, resetSessionTimer, validSessionTime, SessionTimerConflictError } from "@/src/server";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
	const { id } = await params;
	if (!/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ error: "Invalid session id" }, { status: 400 });
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	try {
		return Response.json(readSessionTimerState(id), { headers: { "Cache-Control": "no-store" } });
	} catch {
		return Response.json({ error: "Could not load session time" }, { status: 500 });
	}
}

export async function POST(req: Request, { params }: Context) {
	const { id } = await params;
	if (!/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ error: "Invalid session id" }, { status: 400 });
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = await req.json().catch(() => null);
	const generation = body?.generation === undefined ? 0 : body.generation;
	if (!validSessionTime(body?.elapsedMs) || !validSessionTime(generation)) return Response.json({ error: "Invalid elapsed time" }, { status: 400 });
	try {
		return Response.json({ elapsedMs: writeSessionTimer(id, body.elapsedMs, generation), generation });
	} catch (error) {
		if (error instanceof SessionTimerConflictError) return Response.json({ error: error.message, ...error.state }, { status: 409 });
		return Response.json({ error: "Could not save session time" }, { status: 500 });
	}
}

export async function DELETE(req: Request, { params }: Context) {
	const { id } = await params;
	if (!/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ error: "Invalid session id" }, { status: 400 });
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = await req.json().catch(() => null);
	if (!validSessionTime(body?.generation)) return Response.json({ error: "Invalid timer generation" }, { status: 400 });
	try { return Response.json(resetSessionTimer(id, body.generation)); }
	catch (error) {
		if (error instanceof SessionTimerConflictError) return Response.json({ error: error.message, ...error.state }, { status: 409 });
		return Response.json({ error: "Could not reset session time" }, { status: 500 });
	}
}
