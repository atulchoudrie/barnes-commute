"use client";
import { useState } from "react";

/** "At the crossing? It's: Open / Down" – saved with the live state at that moment, to tune the live barrier. */
export default function ReportBarrier({ commuteKey }: { commuteKey: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const report = async (state: "up" | "down") => {
    setSent("Sending…");
    try {
      const res = await fetch(`/api/observe?key=${encodeURIComponent(commuteKey)}&state=${state}`, { method: "POST" });
      const j = await res.json();
      setSent(!j.ok ? "Couldn't send – try again" : j.matched === false ? "Thanks – noted (live status disagreed)" : "Thanks – noted");
    } catch {
      setSent("Couldn't send – try again");
    }
  };
  const btn = "rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 active:bg-slate-100";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span>At the crossing? It&apos;s:</span>
      <button className={btn} onClick={() => report("up")}>↑ Open</button>
      <button className={btn} onClick={() => report("down")}>↓ Down</button>
      {sent && <span>{sent}</span>}
    </div>
  );
}
