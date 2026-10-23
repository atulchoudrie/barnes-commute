# Barnes → Waterloo commute widget

A home-screen widget and phone page showing:
- the next trains from Barnes to London Waterloo, and when to leave the house for each (time to get out of the door + walk + a minute spare on the platform);
- the way home: the next trains from Waterloo to Barnes, their platform, and when you'll be at Barnes and home;
- whether the White Hart Lane level-crossing barrier (between Barnes and Mortlake) is down, when it next changes, and a forecast of closures.

`/` is the phone page (refreshes itself every 30 seconds; *Add to Home Screen*). `/api/board` is the same as JSON for the widget. Set `COMMUTE_KEY` and add `?key=…` to both to keep them private.

Everything here runs on free plans: Vercel (this app), Render (the live barrier worker), and free Realtime Trains and Network Rail data accounts.

## Setup

1. Sign in at the [Realtime Trains API portal](https://api-portal.rtt.io) (with a free Realtime Trains account) and request a token. The free plan allows 100 requests an hour; the app caches lookups to stay well inside that.
2. Import this repo into Vercel (Framework: Next.js) and add the variables from `.env.example`: at least `RTT_TOKEN` and your home location (`COMMUTE_HOME_LAT` / `COMMUTE_HOME_LON` – right-click your house in Google Maps to copy them) or `COMMUTE_WALK_MINUTES`.
3. **iPhone widget**: install [Scriptable](https://scriptable.app), paste in `widgets/barnes-commute.js` (`BOARD_URL` at the top points at this app), then add a Scriptable widget (small, medium or large) to the home screen and pick the script. The widget shows the journey to Waterloo before 1pm and the way home after; set a widget's Parameter to `to` or `from` to fix it to one direction. Countdowns keep ticking between iOS refreshes. `/api/board?journey=to|from` fetches only one direction, which keeps a widget refreshing all day inside the free Realtime Trains limits.
4. **Live barrier** (optional): deploy `worker/barrier` – see [its README](worker/barrier/README.md) – and set `BARRIER_LIVE_URL` / `BARRIER_LIVE_KEY`.

## How it works

- **Leave time** (`lib/commute.ts`) = expected departure − platform spare − walk − time to get out of the door. Walk time from a home location is straight-line distance × 1.3 for streets, at 4.8 km/h.
- **Barrier forecast**: from the Realtime Trains API (data.rtt.io, `lib/rtt.ts`), using Mortlake times – trains towards Richmond cross about a minute before reaching Mortlake, trains towards London about a minute after leaving it; fast trains that skip Mortlake are estimated from Clapham Junction / Richmond. Each closes the barrier from 3 min before to 1 min after (`COMMUTE_BARRIER_*`), and closures under a minute apart are joined.
- **Live barrier** (`worker/barrier`): Network Rail doesn't publish this barrier's position, but its signalling feed shows where every train is. The protecting signal can't clear until the barriers are down, so a train at that signal, or just past it, means down; one approaching means closing. The board uses this for "now" while the worker is connected, keeping the forecast for later closures and as a fallback.
- If the walk crosses the barrier (`COMMUTE_WALK_TO_CROSSING_MINUTES`), the leave time is brought forward when a closure would otherwise make you miss the train.

## Development

```bash
npm install
npm test        # leave-time, barrier forecast and live-tracker tests
npm run dev     # http://localhost:3000 (needs RTT_TOKEN in .env.local)
```
