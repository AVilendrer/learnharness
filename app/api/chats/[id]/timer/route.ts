import { getChat, readSessionTimer, writeSessionTimer, validSessionTime } from "@/src/server";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
	const { id } = await params;
	if (!/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ error: "Invalid session id" }, { status: 400 });
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	try {
		return Response.json({ elapsedMs: readSessionTimer(id) }, { headers: { "Cache-Control": "no-store" } });
	} catch {
		return Response.json({ error: "Could not load session time" }, { status: 500 });
	}
}

export async function POST(req: Request, { params }: Context) {
	const { id } = await params;
	if (!/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ error: "Invalid session id" }, { status: 400 });
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = await req.json().catch(() => null);
	if (!validSessionTime(body?.elapsedMs)) return Response.json({ error: "Invalid elapsed time" }, { status: 400 });
	try {
		return Response.json({ elapsedMs: writeSessionTimer(id, body.elapsedMs) });
	} catch {
		return Response.json({ error: "Could not save session time" }, { status: 500 });
	}
}
