// test-session.js
//
// PURPOSE: Log into solidcore.co using a persistent browser context.
// Run it once, log in manually (complete SMS if needed), then close.
// Run it again later — if you're still logged in, persistent context works
// and the bot can reuse your session.

const { chromium } = require("playwright");
const path = require("path");

// This folder stores all browser state (cookies, localStorage, sessionStorage)
// between runs — just like a real Chrome profile.
const USER_DATA_DIR = path.join(__dirname, "browser-data");

(async () => {
  console.log("Launching browser with persistent context...");
  console.log(`Session data stored in: ${USER_DATA_DIR}\n`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, // You need to see the browser to log in manually
    viewport: { width: 1280, height: 800 },
    // Mimic a real browser to avoid bot detection
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = context.pages()[0] || (await context.newPage());

  // Navigate to Solid Core's booking/account page
  await page.goto("https://www.solidcore.co/auth/schedule", {
    waitUntil: "networkidle",
  });

  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);

  // Check if we landed on a login page or the actual booking page
  if (
    currentUrl.includes("login") ||
    currentUrl.includes("sign-in") ||
    currentUrl.includes("auth")
  ) {
    console.log("\n--- NOT LOGGED IN ---");
    console.log("Log in manually in the browser window that just opened.");
    console.log("Complete SMS verification if prompted.");
    console.log(
      "Once you're logged in and see the booking page, come back here and press Ctrl+C.\n",
    );
  } else {
    console.log("\n--- ALREADY LOGGED IN ---");
    console.log("Session persisted! The persistent context is working.");
    console.log(
      "This means the bot can reuse this session without re-authenticating.\n",
    );
  }

  // Keep the browser open so you can interact with it
  console.log("Browser is open. Press Ctrl+C to close when done.");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nSaving session and closing browser...");
    await context.close();
    console.log("Done. Run this script again to test if the session persists.");
    process.exit(0);
  });
})();
