import { NextResponse } from "next/server";
import { configFromEnv } from "@/lib/commute";
import { commuteKeyOk, journeyParam, loadBoard } from "@/lib/rtt";

// JSON for the home-screen widget (widgets/barnes-commute.js). ?journey=to|from limits it to one direction.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  if (!commuteKeyOk(params.get("key"))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  try {
    const board = await loadBoard(configFromEnv(process.env), journeyParam(params.get("journey")));
    return NextResponse.json(board, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
