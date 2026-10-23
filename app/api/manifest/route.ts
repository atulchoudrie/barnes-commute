import { commuteKeyOk } from "@/lib/rtt";

// Web app manifest, so "Add to Home screen" (Android) opens the board full screen with its key: /api/manifest?key=…
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!commuteKeyOk(key)) return Response.json({ error: "unauthorised" }, { status: 401 });
  return Response.json({
    name: "Barnes trains",
    short_name: "Trains",
    start_url: `/?key=${encodeURIComponent(key)}`,
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    icons: [192, 512].map((s) => ({ src: `/api/icon/${s}`, sizes: `${s}x${s}`, type: "image/png", purpose: "any maskable" })),
  }, { headers: { "content-type": "application/manifest+json" } });
}
