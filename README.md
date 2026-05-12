# kk-booking-bot

Automated booking tool for [Solidcore](https://www.solidcore.co) fitness classes.

The monthly Solidcore schedule drops at **12:00 AM on the 23rd** of each month, and popular classes fill within seconds. This bot stays armed overnight, then spawns parallel headless browser agents at midnight — one per class — that each navigate the booking UI and complete the reservation simultaneously.

## How it works

1. **The night before** — you log into Solidcore once through a Playwright browser (email + SMS verification). Session cookies + localStorage are saved to `browser-data/`.
2. **Before bed** — you run `npm run arm`. The scheduler reads `preferences.json`, counts down to the target time, and keeps the Mac awake via `caffeinate`.
3. **At T-0** — the orchestrator copies the saved session to per-agent temp dirs, launches one Playwright context per class in parallel, and each agent runs the full booking flow: set location → apply time + class-type filters → pick the date → click "book" → select a pass → confirm.
4. **In the morning** — you check the results summary (console + log file).

## Tech stack

- **Node.js** runtime
- **Playwright** — `launchPersistentContext` for session reuse and parallel headless browsers
- **React + Vite** — local preference-input UI
- **Native `setTimeout` + `caffeinate`** — no cron, no external infra

## Quick start

```bash
# One-time setup
chmod +x setup.sh
./setup.sh

# Evening of the 22nd — log in (one-time per session lifetime)
npm run login
# Browser opens → log in → complete SMS → Ctrl+C to save

# Before bed — arm the scheduler
npm run arm
# Prints countdown; fires orchestrator at preferences.target_date/time

# Anytime — test the flow without waiting
npm run book-now
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run login` | Opens Playwright browser to Solidcore for manual login + SMS. Persists session to `browser-data/`. |
| `npm run arm` | Reads `preferences.json`, counts down to `target_date`/`target_time`, then triggers the orchestrator. |
| `npm run book-now` | Runs the orchestrator immediately (skips countdown). For testing. |
| `npm run test-session` | Checks whether the saved session is still valid. |
| `npm run ui` | Starts the local React preference-input UI on Vite. |

## `preferences.json`

```json
{
  "target_date": "2025-04-23",
  "target_time": "00:00:00",
  "bookings": [
    {
      "location": "NY, East Village",
      "date": "2025-05-05",
      "time_start": "18:00",
      "time_end": "19:00",
      "class_type": "Signature50",
      "instructor_preference": "Milan H.",
      "priority": 1
    }
  ]
}
```

- `target_date` / `target_time` — when the schedule drops (the 23rd at midnight). Drives the countdown.
- `bookings[]` — one entry per class to book; each gets its own parallel browser agent.
- `class_type` — one of `Signature50`, `Power30`, `Off-Peak Signature50`, `Focus50`, `Starter50`, `Advanced50`, `Off-Peak Starter50`.

## Project layout

```
kk-booking-bot/
├── src/
│   ├── login.js          # Manual login + session capture
│   ├── scheduler.js      # setTimeout countdown + caffeinate
│   ├── orchestrator.js   # Spawns parallel agents at T-0
│   ├── agent.js          # Full booking flow for a single class
│   ├── notify.js         # Result summary + log file
│   └── ui/               # React preference-input app (Vite)
├── test-session.js       # Verifies persisted session is still valid
├── preferences.json      # Class preferences (gitignored sample lives here)
├── browser-data/         # Playwright persistent session (gitignored)
└── setup.sh
```

See `PROJECT_SPEC.md` for the full design — selector strategy, filter handling, parallel-context isolation, error modes, and known risks.

## Notes

- The booking flow goes through the live Solidcore UI (no public API). Selectors in `agent.js` are defensive but the site can change — the spec calls out an LLM-agent fallback as future work.
- Sessions have been observed to persist 1.5+ hours; logging in within a few hours of midnight is safest.
- Automated booking likely violates Solidcore's TOS. Personal use, low volume, residential IP.
