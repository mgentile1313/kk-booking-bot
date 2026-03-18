# KK Booking Bot — Project Spec

## What this is

An automated booking tool for Solid Core fitness classes. The monthly class schedule drops at 12:00 AM on the 23rd of each month and popular classes fill within seconds. This bot books her preferred classes automatically so she doesn't have to stay up.

## How it works

She inputs her preferred classes ahead of time. On the evening of the 22nd, she logs into Solid Core through a Playwright browser (one-time SMS verification). Before bed, she runs `npm run arm`. The process stays alive, counting down to 12:00 AM on the 23rd. At midnight sharp, it spawns parallel browser agents — one per class — that each navigate the booking UI and click through the reservation flow simultaneously.

## Tech stack

- **Runtime:** Node.js
- **Browser automation:** Playwright (persistent context for session reuse)
- **Frontend:** React (simple preference input form)
- **LLM agent layer:** TBD — either `browser-use` or custom Playwright + Claude API for resilient page interaction
- **Scheduling:** Native `setTimeout` in a long-running Node process (no cron, no external infra)
- **Runs on:** Her MacBook (lid open, process running in terminal)

## Project structure

```
kk-booking-bot/
├── package.json
├── preferences.json          # Her saved class preferences
├── browser-data/              # Playwright persistent session (gitignored)
├── src/
│   ├── ui/                    # React preference input app
│   │   ├── App.jsx
│   │   └── index.html
│   ├── login.js               # Opens browser for manual login + SMS
│   ├── scheduler.js           # setTimeout countdown to target time
│   ├── orchestrator.js        # Reads prefs, spawns parallel agents
│   ├── agent.js               # Single booking agent (one class)
│   └── notify.js              # Post-run summary notification
├── test-session.js            # Session persistence test (already built)
└── .gitignore                 # browser-data/, node_modules/
```

## npm scripts

```json
{
  "scripts": {
    "login": "node src/login.js",
    "arm": "node src/scheduler.js",
    "book-now": "node src/orchestrator.js",
    "test-session": "node test-session.js",
    "ui": "vite src/ui"
  }
}
```

- `npm run login` — Opens Playwright browser. She logs in, completes SMS. Session saved to `browser-data/`. Run this on the evening of the 22nd.
- `npm run arm` — Starts the scheduler. Calculates time until the 23rd at 12:00 AM, prints a countdown, then triggers the orchestrator at midnight. Run this before bed.
- `npm run book-now` — Skips the scheduler, runs the orchestrator immediately. For testing.
- `npm run test-session` — Checks if the persisted session is still valid.
- `npm run ui` — Starts the preference input UI on localhost.

## preferences.json schema

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
    },
    {
      "location": "NY, East Village",
      "date": "2025-05-07",
      "time_start": "17:00",
      "time_end": "18:00",
      "class_type": "Signature50",
      "instructor_preference": null,
      "priority": 2
    }
  ]
}
```

Fields:
- `target_date` + `target_time`: When the schedule drops (the 23rd at midnight). The scheduler counts down to this.
- `bookings[]`: Array of classes to book. Each gets its own parallel browser agent.
- `location`: Must match the "Home Studio" dropdown text on solidcore.co.
- `date`: The actual class date (will be in the following month).
- `time_start` / `time_end`: Maps to the "Time of the day" filter slider. Also used to identify the specific class row.
- `class_type`: One of: Signature50, Power30, Off-Peak Signature50, Focus50, Starter50, Advanced50, Off-Peak Starter50.
- `instructor_preference`: Optional. If set, agent prefers this instructor's class within the time window.
- `priority`: Lower number = higher priority. If the agent can't book the exact match, it tries the next-best option.

## Component details

### 1. login.js

Opens a Playwright persistent context browser pointed at `https://www.solidcore.co/auth/schedule`. She logs in manually, completes SMS verification. When she's on the schedule page, she presses Ctrl+C in terminal. Session is saved to `browser-data/`.

This is essentially the existing `test-session.js` with cleaner output messaging.

### 2. scheduler.js

- Reads `preferences.json` to get `target_date` and `target_time`.
- Calculates milliseconds until that datetime.
- Prints a human-readable countdown to the console every 30 seconds (e.g., "2h 14m 30s until schedule drop").
- At T-5 minutes: prints a warning that execution is imminent.
- At T-0: calls the orchestrator.
- Keeps the Mac awake using `caffeinate` (spawn a child process: `child_process.spawn('caffeinate', ['-i'])`) so the machine doesn't sleep while waiting.

### 3. orchestrator.js

- Reads `preferences.json` to get the bookings array.
- For each booking, spawns a Playwright persistent context (all sharing the same `browser-data/` session store — note: Playwright allows multiple contexts reading from the same user data dir, but they should be launched as separate browser instances to avoid lock conflicts. Alternatively, copy `browser-data/` to temp dirs per agent).
- Waits until all browser instances are loaded and navigated to the schedule page.
- At the exact target time (or immediately if launched via `npm run book-now`), signals all agents to begin simultaneously.
- Collects results from all agents (success, failure, waitlisted).
- Passes results to notify.js.

### 4. agent.js

The core booking logic. Takes a single booking preference object and a Playwright browser context. Executes this sequence:

**Step 1: Navigate**
Go to `https://www.solidcore.co/auth/schedule`. Verify we're logged in (not redirected to login page).

**Step 2: Set location filter**
Click the "Home Studio" dropdown. Select the matching location.

**Step 3: Set time + class type filters**
Click "Filters". Adjust the time slider to match `time_start` and `time_end`. Click the matching `class_type` chip. Close filters.

**Step 4: Select date**
Click the correct date in the horizontal date picker at the top. May need to click the right arrow to navigate to future dates.

**Step 5: Find and click "book"**
Scan the class list for the row matching the time and (optionally) instructor. Click the blue "book" button on that row.

**Step 6: Select pass and confirm**
On the confirmation page (`/auth/purchase`), select an available pass. Click "Book Class".

**Step 7: Verify**
Confirm the booking succeeded (look for confirmation text, or check that we're not still on the purchase page with an error).

**Error handling:**
- If the class is full (shows "join waitlist" instead of "book"), log it and optionally join the waitlist.
- If the page doesn't load or session is expired, log the error.
- If the target class isn't found (wrong time, schedule different than expected), log it and try the closest match.

### 5. notify.js

After all agents complete, compile results and output:
- Console: table showing each booking attempt and result (booked / waitlisted / failed).
- Optional: send an SMS or email summary. Can use a free service like Pushover or just write to a log file she checks in the morning.

### 6. Preference UI (src/ui/)

A simple React app running on localhost via Vite. Features:
- Dropdown for location (populated from known Solid Core locations).
- Date picker for class date.
- Time range selector (matching the filter UI on solidcore.co).
- Class type selector (chips matching the filter options: Signature50, Power30, etc.).
- Optional instructor name text field.
- Priority drag-and-drop ordering.
- "Save" button that writes to `preferences.json`.

This is a convenience layer. She can also edit `preferences.json` directly.

## Solid Core website details (from recon)

- Schedule URL: `https://www.solidcore.co/auth/schedule`
- Purchase/confirmation URL: `https://www.solidcore.co/auth/purchase` (state is client-side, URL is not deep-linkable)
- Auth: email + SMS 6-digit code. Session persists via `AUTH_TOKEN` cookie (session expiry) + `sa-user-id` in localStorage (device recognition). Playwright persistent context preserves both.
- Session tested to persist 1.5+ hours between browser closes.
- No usable API endpoints — all booking must happen through UI interaction.
- Booking flow is 2 pages: schedule page (find + click "book") → confirmation page (select pass + click "Book Class").
- Filters available: "Home Studio" (location dropdown), "Time of the day" (range slider, 3AM-11PM), "Class Type" (chip selector).
- Class types: Signature50, Power30, Off-Peak Signature50, Focus50, Starter50, Advanced50, Off-Peak Starter50.
- Schedule drops on the 23rd of each month at 12:00 AM for the following month.
- She has an active membership with passes available.

## Build order

1. **agent.js** — The hardest part. Get a single agent reliably booking one class. Hardcode a test preference and run against the live site.
2. **orchestrator.js** — Parallel execution of multiple agents.
3. **scheduler.js** — The setTimeout + caffeinate wrapper.
4. **login.js** — Clean up the existing test-session.js.
5. **Preference UI** — Last, because she can edit JSON directly until then.
6. **notify.js** — Nice to have, add after core flow works.

## Key risks

- **Bot detection:** Solid Core may use Cloudflare or similar. Mitigate with Playwright stealth plugin, realistic user agents, and slight random delays (200-500ms) between actions.
- **DOM changes:** The site's HTML structure may change. An agentic approach (LLM observing the page) is more resilient than hard-coded selectors, but slower. Start with selectors, add agent fallback.
- **Session expiry:** If the session expires between login and midnight, the bot fails. Mitigate by logging in as close to midnight as practical (10-11 PM).
- **Parallel context conflicts:** Multiple Playwright instances sharing `browser-data/` may cause lock issues. Solution: copy the session directory to a temp dir per agent.
- **TOS violation:** Automated booking likely violates Solid Core's terms. Personal use, low volume, residential IP. Risk is account ban if detected.
