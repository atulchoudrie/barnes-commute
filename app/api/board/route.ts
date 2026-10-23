import { NextResponse } from "next/server";
import { configFromEnv } from "@/lib/commute";
import { commuteKeyOk, loadBoard } from "@/lib/rtt";

// JSON for the home-screen widget (widgets/barnes-commute.js).
export async function GET(req: Request) {
  if (!commuteKeyOk(new URL(req.url).searchParams.get("key"))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  try {
    const board = await loadBoard(configFromEnv(process.env));
    return NextResponse.json(board, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
