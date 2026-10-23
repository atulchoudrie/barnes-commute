import "server-only";
import { unstable_cache } from "next/cache";
import { BARNES, WATERLOO, type StationBoardService } from "./commute";

// National Rail Live Departure Boards (Darwin) – the data behind station screens – via the Rail Data Marketplace
// (free; raildata.org.uk → "Live Departure Board"). Used only to label trains home with the destination and platform
// the Waterloo boards show (loop trains are shown as e.g. "Teddington", not "London Waterloo"). Separate from, and
// costs nothing against, the Realtime Trains limits. LDB_KEY is the product's consumer key; LDB_URL its base URL.
const DEFAULT_URL = "https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120";

interface LdbBoard {
  trainServices?: {
    std?: string;
    platform?: string;
    isCancelled?: boolean;
    destination?: { locationName?: string }[];
  }[];
}

async function fetchBoard(url: string, key: string): Promise<StationBoardService[]> {
  const res = await fetch(url, { headers: { "x-apikey": key, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Live Departure Boards returned ${res.status}`);
  const j = (await res.json()) as LdbBoard;
  return (j.trainServices ?? []).filter((s) => s.std).map((s) => ({
    std: s.std!,
    platform: s.platform ?? null,
    cancelled: !!s.isCancelled,
    destination: (s.destination ?? []).map((d) => d.locationName).filter(Boolean).join(" / ") || null,
  }));
}

/** Waterloo's departure board, trains calling at Barnes. Null if not set up or unavailable (the page then does without). */
export async function waterlooBoardToBarnes(): Promise<StationBoardService[] | null> {
  const key = process.env.LDB_KEY;
  if (!key) return null;
  const base = (process.env.LDB_URL || DEFAULT_URL).replace(/\/$/, "");
  const url = `${base}/GetDepartureBoard/${WATERLOO.crs}?numRows=20&filterCrs=${BARNES.crs}&filterType=to&timeWindow=120`;
  try {
    return await unstable_cache(() => fetchBoard(url, key), ["ldb", url], { revalidate: 60 })();
  } catch (e) {
    console.error("station board:", (e as Error).message);
    return null;
  }
}
