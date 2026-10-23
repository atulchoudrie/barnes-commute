import { commuteKeyOk } from "@/lib/rtt";

// "At the crossing? It's open / down" from the page: passed to the barrier worker, which saves it next to what the
// live state said at that moment (worker /debug → observations), for tuning when it says closing / down.
export async function POST(req: Request) {
  const params = new URL(req.url).searchParams;
  if (!commuteKeyOk(params.get("key"))) return Response.json({ error: "unauthorised" }, { status: 401 });
  const state = params.get("state");
  const worker = process.env.BARRIER_LIVE_URL;
  if ((state !== "up" && state !== "down") || !worker) return Response.json({ error: "not available" }, { status: 400 });
  try {
    const res = await fetch(`${worker.replace(/\/$/, "")}/observe?state=${state}`, {
      headers: { "x-worker-key": process.env.BARRIER_LIVE_KEY ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    return Response.json({ ok: res.ok, matched: j.matched ?? null });
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
