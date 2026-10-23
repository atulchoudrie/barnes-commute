// Always-on worker: listens to Network Rail's TD feed and serves the live White Hart Lane barrier state.
//   GET /status   – current state (used by the board's /api/board)
//   GET /debug    – berths, recent train steps and signal bit changes, observations: for checking the berth setup
//   GET /observe?state=down|up – record what you can see at the crossing, to check the live state against
// All but /health need ?key=WORKER_KEY (or an x-worker-key header) when WORKER_KEY is set.
import http from "node:http";
import { DEFAULT_DIRECTIONS, Tracker, parseTd, type Direction, type LiveStatus } from "./td.ts";
import { runStomp } from "./stomp.ts";

const env = process.env;
if (!env.NR_USERNAME || !env.NR_PASSWORD) {
  console.error("Set NR_USERNAME and NR_PASSWORD (Network Rail open data account: publicdatafeeds.networkrail.co.uk)");
  process.exit(1);
}

const tracker = new Tracker({
  area: env.TD_AREA || null,
  directions: env.BARRIER_DIRECTIONS ? (JSON.parse(env.BARRIER_DIRECTIONS) as Direction[]) : DEFAULT_DIRECTIONS,
  clearSeconds: Number(env.BARRIER_CLEAR_SECONDS) || 45,
});

let feed = { state: "connecting", detail: "", since: Date.now() };
const observations: { time: number; seen: "down" | "up"; live: LiveStatus }[] = [];

runStomp({
  host: env.NR_HOST || "publicdatafeeds.networkrail.co.uk",
  port: Number(env.NR_PORT) || 61618,
  login: env.NR_USERNAME,
  passcode: env.NR_PASSWORD,
  destination: `/topic/${env.NR_TOPIC || "TD_ALL_SIG_AREA"}`,
  onMessage: (body) => { for (const m of parseTd(body)) tracker.apply(m); },
  onState: (state, detail = "") => {
    feed = { state, detail, since: Date.now() };
    console.log(new Date().toISOString(), "feed", state, detail);
  },
});

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health") return json(res, 200, { ok: true, feed });
  const key = env.WORKER_KEY;
  if (key && url.searchParams.get("key") !== key && req.headers["x-worker-key"] !== key) return json(res, 401, { error: "unauthorised" });

  const now = Date.now();
  if (url.pathname === "/status") return json(res, 200, { now, feed, ...tracker.status(now) });
  if (url.pathname === "/observe") {
    const seen = url.searchParams.get("state");
    if (seen !== "down" && seen !== "up") return json(res, 400, { error: "state must be down or up" });
    const o = { time: now, seen, live: tracker.status(now) } as const;
    observations.push(o);
    if (observations.length > 500) observations.shift();
    console.log("observation", JSON.stringify(o));
    return json(res, 200, { ok: true, matched: o.live.down === (seen === "down"), live: o.live });
  }
  if (url.pathname === "/debug") {
    const { area } = tracker.area();
    return json(res, 200, {
      now, feed, status: tracker.status(now), config: tracker.cfg,
      areaCandidates: Object.fromEntries([...tracker.stepsSeen].map(([a, s]) => [a, [...s]])),
      berths: area ? Object.fromEntries(tracker.berths.get(area) ?? []) : null,
      recentSteps: tracker.recentSteps.slice(-100),
      recentSignalChanges: tracker.recentSignals.slice(-200),
      observations: observations.slice(-50),
    });
  }
  json(res, 404, { error: "not found" });
}).listen(Number(env.PORT) || 8080, () => console.log("listening on", Number(env.PORT) || 8080));
