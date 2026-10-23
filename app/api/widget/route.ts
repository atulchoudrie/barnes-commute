import { readFile } from "node:fs/promises";
import path from "node:path";
import { commuteKeyOk } from "@/lib/rtt";

// The iPhone widget script (widgets/barnes-commute.js) as plain text, pointing at this app, so it can be opened on the
// phone and copied into Scriptable: /api/widget?key=…
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  if (!commuteKeyOk(key)) return new Response("Add ?key=… to the link.", { status: 401 });
  const script = await readFile(path.join(process.cwd(), "widgets/barnes-commute.js"), "utf8");
  const board = `${url.origin}/api/board?key=${encodeURIComponent(key)}`;
  return new Response(script.replace(/^const BOARD_URL = .*$/m, `const BOARD_URL = ${JSON.stringify(board)};`), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
