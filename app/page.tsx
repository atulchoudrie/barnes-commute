import type { Metadata, Viewport } from "next";
import { configFromEnv, formatClock, type Board, type BoardTrain, type ReturnTrain } from "@/lib/commute";
import { commuteKeyOk, loadBoard } from "@/lib/rtt";
import AutoRefresh from "./AutoRefresh";

// Phone page for Barnes → Waterloo. Add it to the home screen (Share → Add to Home Screen); it refreshes itself.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Barnes → Waterloo",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Trains", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f5f7" };

function leaveText(t: BoardTrain): string {
  const m = t.plan!.leaveInMinutes;
  if (m <= 0) return "Leave now";
  return `Leave in ${m} min`;
}

function TrainRow({ t, first }: { t: BoardTrain; first: boolean }) {
  return (
    <li className={`flex items-center justify-between gap-3 py-3 ${first ? "" : "border-t border-slate-200"} ${t.catchable || t.cancelled ? "" : "opacity-50"}`}>
      <div>
        <div className="text-lg font-semibold tabular-nums">
          {formatClock(t.scheduled)}
          {t.cancelled ? <span className="ml-2 text-sm font-medium text-red-600">Cancelled</span>
            : t.delayMinutes > 0 ? <span className="ml-2 text-sm font-medium text-amber-600">exp {formatClock(t.expected)}</span>
            : <span className="ml-2 text-sm font-medium text-emerald-600">On time</span>}
        </div>
        <div className="text-xs text-slate-500">{t.bus ? "Bus · " : ""}{t.platform ? `Platform ${t.platform}` : "Platform –"}</div>
      </div>
      {t.plan && (
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">Leave {formatClock(t.plan.leaveAt)}</div>
          <div className="text-xs text-slate-500">
            {t.catchable ? leaveText(t) : "Too late"}
            {t.plan.barrierExtraMinutes > 0 ? ` · +${t.plan.barrierExtraMinutes} min for barrier` : ""}
          </div>
        </div>
      )}
    </li>
  );
}

function barrierHeadline(b: Board["barrier"]): string {
  if (b.down) return b.changesAt ? `Down – opens about ${formatClock(b.changesAt)}` : "Down";
  if (b.closingSoon) return "Closing – train approaching";
  return b.changesAt ? `Open until about ${formatClock(b.changesAt)}` : "Open – no trains due";
}

function BarrierCard({ b, now }: { b: Board["barrier"]; now: number }) {
  const next = b.windows.slice(0, 6);
  const span = 45 * 60_000; // timeline covers the next 45 minutes
  return (
    <section className="rounded-2xl bg-white p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-500">
          {b.name}
          {b.source === "live" && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700">Live</span>}
        </h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.down ? "bg-red-50 text-red-700" : b.closingSoon ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
          {b.down ? "Down" : b.closingSoon ? "Closing" : "Open"}
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold">{barrierHeadline(b)}</p>
      {b.liveTrains.length > 0 && (
        <p className="text-xs text-slate-500">{b.liveTrains.map((t) => `${t.descr} ${t.direction}`).join(" · ")}</p>
      )}
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-emerald-100" aria-hidden>
        {b.windows.filter((w) => w.closes < now + span).map((w, i) => (
          <div key={i} className="absolute inset-y-0 bg-red-600/80"
            style={{ left: `${Math.max(0, (w.closes - now) / span) * 100}%`, width: `${((Math.min(w.opens, now + span) - Math.max(w.closes, now)) / span) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>now</span><span>+15</span><span>+30</span><span>+45 min (forecast)</span></div>
      {next.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm tabular-nums">
          {next.map((w, i) => (
            <li key={i} className="flex justify-between">
              <span>Down {formatClock(w.closes)}–{formatClock(w.opens)}</span>
              <span className="text-slate-500">{w.trains} train{w.trains > 1 ? "s" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-400">
        {b.source === "live" ? "Now: live, from where trains are on the signalling system. Later closures: forecast from train times."
          : "Estimated from train times; the live feed isn't available right now."}
      </p>
    </section>
  );
}

function ReturnRow({ t, first }: { t: ReturnTrain; first: boolean }) {
  return (
    <li className={`flex items-center justify-between gap-3 py-3 ${first ? "" : "border-t border-slate-200"}`}>
      <div>
        <div className="text-lg font-semibold tabular-nums">
          {formatClock(t.scheduled)}
          {t.cancelled ? <span className="ml-2 text-sm font-medium text-red-600">Cancelled</span>
            : t.delayMinutes > 0 ? <span className="ml-2 text-sm font-medium text-amber-600">exp {formatClock(t.expected)}</span>
            : <span className="ml-2 text-sm font-medium text-emerald-600">On time</span>}
        </div>
        <div className="text-xs text-slate-500">{t.bus ? "Bus · " : ""}{t.platform ? `Platform ${t.platform}` : "Platform not yet announced"} · to {t.destination}</div>
      </div>
      {!t.cancelled && t.arriveExpected != null && (
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">Barnes {formatClock(t.arriveExpected)}</div>
          {t.homeAt != null && <div className="text-xs text-slate-500 tabular-nums">Home {formatClock(t.homeAt)}</div>}
        </div>
      )}
    </li>
  );
}

const SHOW = 3; // trains listed each way

export default async function CommutePage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  if (!commuteKeyOk(key)) return <main className="p-6 text-sm text-slate-500">Add ?key=… to the link.</main>;

  let board: Board;
  try {
    board = await loadBoard(configFromEnv(process.env));
  } catch (e) {
    return <main className="p-6 text-sm text-red-700"><AutoRefresh seconds={30} />Couldn&apos;t load trains: {(e as Error).message}</main>;
  }
  const { next, config: c } = board;
  // Just the next few you can still make (a cancelled one stays in so you know about it).
  const upcoming = board.trains.filter((t) => t.catchable || t.cancelled).slice(0, SHOW);

  return (
    <main className="mx-auto max-w-md space-y-4 bg-slate-50 p-4 pb-10">
      <AutoRefresh seconds={30} />
      <header className="pt-2">
        <p className="text-sm text-slate-500">Barnes → London Waterloo</p>
        {next?.plan ? (
          <>
            <h1 className={`text-4xl font-bold tracking-display ${next.plan.leaveInMinutes <= 1 ? "text-red-600" : ""}`}>{leaveText(next)}</h1>
            <p className="mt-1 text-slate-600">
              Leave at <b className="tabular-nums">{formatClock(next.plan.leaveAt)}</b> for the <b className="tabular-nums">{formatClock(next.scheduled)}</b>
              {next.delayMinutes > 0 ? ` (exp ${formatClock(next.expected)})` : ""}
            </p>
          </>
        ) : <h1 className="text-3xl font-bold">No trains you can make</h1>}
        <p className="mt-1 text-xs text-slate-500">
          {c.getOutMinutes} min to get out + {c.walkMinutes} min walk{c.walkSource === "home location" ? " (from your home location)" : ""} + {c.platformBufferMinutes} min spare = {board.journeyMinutes} min door to train
        </p>
      </header>

      <BarrierCard b={board.barrier} now={board.generatedAt} />

      <section className="rounded-2xl bg-white px-4 py-1 shadow-card">
        <ul>{upcoming.map((t, i) => <TrainRow key={t.uid + t.scheduled} t={t} first={i === 0} />)}</ul>
        {upcoming.length === 0 && <p className="py-4 text-sm text-slate-500">No departures in the next hour or so.</p>}
      </section>

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-slate-500">Back from Waterloo</h2>
        <div className="rounded-2xl bg-white px-4 py-1 shadow-card">
          <ul>{(board.back ?? []).slice(0, SHOW).map((t, i) => <ReturnRow key={t.uid + t.scheduled} t={t} first={i === 0} />)}</ul>
          {!board.back?.length && <p className="py-4 text-sm text-slate-500">No trains to Barnes in the next two hours.</p>}
        </div>
      </section>

      <p className="text-center text-xs text-slate-400">Updated {formatClock(board.generatedAt)} · data from Realtime Trains</p>
    </main>
  );
}
