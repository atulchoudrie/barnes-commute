import { autoJourney, configFromEnv, summaryText } from "@/lib/commute";
import { commuteKeyOk, loadBoard } from "@/lib/rtt";

// The board as a few lines of plain text, for Android widget apps that show text from a URL (e.g. KWGT):
// /api/text?key=…[&journey=to|from] – without journey, it's "to" Waterloo before 1pm and "from" after.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  if (!commuteKeyOk(params.get("key"))) return new Response("Add ?key=… to the link.", { status: 401 });
  const now = Date.now();
  const j = params.get("journey");
  const journey = j === "to" || j === "from" ? j : autoJourney(now);
  const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
  try {
    const board = await loadBoard(configFromEnv(process.env), journey, now);
    return new Response(summaryText(board, journey, now), { headers });
  } catch (e) {
    return new Response(`Trains unavailable: ${(e as Error).message}`, { headers });
  }
}
