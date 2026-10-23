// Barnes → Waterloo home-screen widget for iPhone / iPad, using the free Scriptable app (scriptable.app).
//
// Setup:
//   1. Install Scriptable, tap +, paste this whole file, name it "Barnes trains".
//   2. Set BOARD_URL below to your deployment's /api/board address (add ?key=… if you set COMMUTE_KEY).
//   3. Long-press the home screen → + → Scriptable → pick Small, Medium or Large → tap the widget while
//      jiggling → Script: "Barnes trains". Tapping the widget opens the full board.
//
// iOS decides how often widgets refresh (usually every 5–15 minutes), so the "leave in" countdown and the
// barrier state are worked out on the phone from the times last downloaded and keep ticking between refreshes.

const BOARD_URL = "https://YOUR-APP.vercel.app/api/board?key=YOUR_KEY";

const url = (args.widgetParameter || BOARD_URL).trim();
const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  text: Color.dynamic(new Color("#1d1d1f"), new Color("#f5f5f7")),
  dim: Color.dynamic(new Color("#6e6e73"), new Color("#a1a1a6")),
  red: new Color("#d70015"), green: new Color("#248a3d"), amber: new Color("#b25000"),
};

const clock = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

async function loadBoard() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), "barnes-commute.json");
  try {
    const req = new Request(url);
    req.timeoutInterval = 10;
    const board = await req.loadJSON();
    if (board.error) throw new Error(board.error);
    fm.writeString(cache, JSON.stringify(board));
    return board;
  } catch (e) {
    if (fm.fileExists(cache)) return { ...JSON.parse(fm.readString(cache)), stale: true };
    return { error: String(e.message || e) };
  }
}

// Re-derive everything that depends on "now", so a board downloaded a few minutes ago is still right.
// The live barrier state is used while it's fresh; after that, the forecast windows take over.
function current(board, now) {
  const trains = board.trains.filter((t) => t.plan && !t.cancelled && t.plan.leaveAt >= now - 30000);
  const windows = board.barrier.windows.filter((w) => w.opens > now);
  const b = board.barrier;
  if (b.source === "live" && now - board.generatedAt < 2 * 60000) {
    return { trains, windows, live: true, down: b.down, closingSoon: b.closingSoon, changesAt: b.changesAt };
  }
  const down = windows.find((w) => w.closes <= now);
  return { trains, windows, live: false, down: !!down, closingSoon: false, changesAt: down ? down.opens : windows[0] ? windows[0].closes : null };
}

function text(stack, s, size, color, weight = "regular") {
  const t = stack.addText(s);
  t.font = weight === "bold" ? Font.boldSystemFont(size) : weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
  return t;
}

function barrierLine(stack, cur, size) {
  const row = stack.addStack();
  row.centerAlignContent();
  const dot = row.addText("● ");
  dot.font = Font.systemFont(size);
  dot.textColor = cur.down ? C.red : cur.closingSoon ? C.amber : C.green;
  const what = cur.down ? "Barrier down" : cur.closingSoon ? "Barrier closing" : "Barrier open";
  const when = cur.closingSoon || !cur.changesAt ? "" : cur.down ? ` · opens ~${clock(cur.changesAt)}` : ` · shuts ~${clock(cur.changesAt)}`;
  text(row, what + when + (cur.live ? " · live" : ""), size, C.text, "semibold");
}

function build(board, family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 14, 12, 14);
  w.url = url.replace("/api/board", "/");

  if (board.error) {
    text(w, "Barnes trains", 13, C.dim, "semibold");
    w.addSpacer(4);
    const t = text(w, board.error, 12, C.red);
    t.lineLimit = 4;
    return w;
  }

  const now = Date.now();
  const cur = current(board, now);
  const next = cur.trains[0];

  text(w, family === "small" ? "Barnes → WAT" : "Barnes → Waterloo", 12, C.dim, "semibold");
  w.addSpacer(2);

  if (next) {
    const leaveIn = next.plan.leaveAt - now;
    const head = w.addStack();
    head.bottomAlignContent();
    if (leaveIn <= 60000) {
      text(head, "Leave now", family === "small" ? 24 : 28, C.red, "bold");
    } else {
      text(head, "Leave in ", family === "small" ? 24 : 28, C.text, "bold");
      const d = head.addDate(new Date(next.plan.leaveAt));
      d.applyTimerStyle(); // live countdown, keeps ticking between refreshes
      d.font = Font.boldMonospacedSystemFont(family === "small" ? 24 : 28);
      d.textColor = leaveIn < 3 * 60000 ? C.amber : C.text;
    }
    const status = next.delayMinutes > 0 ? `exp ${clock(next.expected)}` : "on time";
    const plat = next.platform ? ` · P${next.platform}` : "";
    text(w, `at ${clock(next.plan.leaveAt)} for the ${clock(next.scheduled)}${family === "small" ? "" : ` (${status}${plat})`}`, 13, next.delayMinutes > 0 ? C.amber : C.dim, "semibold");
    if (next.plan.barrierExtraMinutes > 0) text(w, `${next.plan.barrierExtraMinutes} min early to beat the barrier`, 11, C.amber);
  } else {
    text(w, "No trains you can make", 18, C.text, "bold");
  }

  w.addSpacer(family === "small" ? 6 : 8);
  barrierLine(w, cur, family === "small" ? 12 : 13);

  if (family !== "small") {
    w.addSpacer(6);
    const later = cur.trains.slice(1, family === "large" ? 7 : 3);
    for (const t of later) {
      const row = w.addStack();
      text(row, clock(t.scheduled), 13, C.text, "semibold");
      if (t.delayMinutes > 0) text(row, ` exp ${clock(t.expected)}`, 13, C.amber);
      row.addSpacer();
      text(row, `leave ${clock(t.plan.leaveAt)}`, 13, C.dim);
    }
  }

  if (family === "large" && cur.windows.length) {
    w.addSpacer(8);
    text(w, "Barrier down (estimated)", 12, C.dim, "semibold");
    for (const win of cur.windows.slice(0, 5)) text(w, `${clock(win.closes)} – ${clock(win.opens)}`, 13, C.text);
  }

  w.addSpacer();
  text(w, `${board.stale ? "Offline · " : ""}updated ${clock(board.generatedAt)}`, 9, C.dim);

  // Ask iOS to refresh just after the next thing changes (it may wait longer).
  const changes = [next && next.plan.leaveAt, cur.changesAt].filter((t) => t && t > now);
  w.refreshAfterDate = new Date(Math.min(now + 5 * 60000, ...changes.map((t) => t + 30000)));
  return w;
}

const board = await loadBoard();
const family = config.widgetFamily || "medium";
const widget = build(board, family);
if (config.runsInWidget) Script.setWidget(widget);
else if (family === "small") await widget.presentSmall();
else if (family === "large") await widget.presentLarge();
else await widget.presentMedium();
Script.complete();
