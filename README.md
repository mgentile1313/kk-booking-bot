# Solid Core Auto-Booker — Session Test

## Quick Start

```bash
# 1. Run setup (one time)
chmod +x setup.sh
./setup.sh

# 2. First run — log in manually
node test-session.js
# → Browser opens → Log in → Complete SMS → Press Ctrl+C

# 3. Second run — test persistence (wait at least 30 min, ideally a few hours)
node test-session.js
# → If it says "ALREADY LOGGED IN", you're golden
# → If it says "NOT LOGGED IN", we need to explore other auth strategies
```

## What's happening

Playwright's `launchPersistentContext` saves all browser state (cookies,
localStorage, sessionStorage) to the `browser-data/` folder. This mimics
a real Chrome profile. When you run the script again, it reloads that
state, so the site should think you're the same user on the same device.

## Next steps after this test passes

1. Record the booking flow (Network tab inspection)
2. Build preference input UI
3. Build the booking agent
4. Add parallel execution + scheduling
