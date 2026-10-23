# Live White Hart Lane barrier worker

Listens to Network Rail's Train Describer feed (where every train is, signal section by signal section) and works out
whether the White Hart Lane level-crossing barrier is down. The board and widget read `GET /status`.

It has to run all the time (the feed is a constant stream), so it's a small Docker service rather than a Vercel function.
No dependencies; Node 22.

## Deploy for free (Render + cron-job.org, about 10 minutes, no card needed)

1. **Network Rail feed**: register at https://publicdatafeeds.networkrail.co.uk, confirm the email, and under
   **My feeds** subscribe to **TD** (all areas).
2. **Render**: sign up at https://render.com with GitHub, then **New → Blueprint**, pick this repo and the branch
   with this code. It reads `render.yaml` and asks for:
   - `NR_USERNAME` – your Network Rail account email
   - `NR_PASSWORD` – its password
   - `WORKER_KEY` – the same value as `BARRIER_LIVE_KEY` in Vercel

   When it's deployed, copy the service address (e.g. `https://barnes-barrier.onrender.com`).
3. **Keep it awake**: free Render services sleep after 15 minutes without a request, and lose track of the trains.
   At https://cron-job.org (free) create a job that opens `https://<your service>/health` every 10 minutes.
   One free service running all month fits inside Render's 750 free hours.
4. **Vercel**: set `BARRIER_LIVE_URL` to the service address and redeploy.

If Render ever stops being free, any host that runs a Dockerfile and keeps it running works the same way
(Oracle Cloud's Always Free VM, a Raspberry Pi at home…).

## Checking it

- `GET /health` – whether it's connected to Network Rail.
- `GET /debug?key=…` – the signalling area it found, trains in the Barnes–Mortlake sections, recent train moves and
  signal changes.
- `GET /observe?key=…&state=down` (or `up`) – when you're at the crossing, record what you can see. The reply says
  whether the live state agreed; the last 50 are in `/debug`. Use these to check the section setup below.

## Settings

| Variable | Default | |
|---|---|---|
| `TD_AREA` | `BS` (Barnes) | Network Rail signalling area id; `auto` finds it from train moves between the expected sections |
| `BARRIER_DIRECTIONS` | see `DEFAULT_DIRECTIONS` in `td.ts` | JSON list of `{name, approach[], protect, beyond}` berths |
| `BARRIER_CLEAR_SECONDS` | 45 | How long the barrier stays down after a train passes the protecting signal |
| `NR_TOPIC` | `TD_ALL_SIG_AREA` | Feed topic |
| `PORT` | 8080 | |

The default sections were read off the OpenTrainTimes "windsor" signalling map and checked against live moves (the
area is `BS`): towards Richmond, Barnes platforms (523 or 525) → signal 533 → crossing → 535 (Mortlake); towards
London, Mortlake platform (526) → crossing → 524. If
observations disagree, `/debug` shows the real train moves around the crossing to correct them.
