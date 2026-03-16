// login.js
//
// PURPOSE: Open a persistent Playwright browser so she can log into solidcore.co
// manually (email + SMS verification). The session is saved to browser-data/
// and reused by the booking agents later.
//
// USAGE: npm run login
// Run this on the evening of the 22nd. Log in, complete SMS, then Ctrl+C.

const { chromium } = require("playwright");
const path = require("path");

const USER_DATA_DIR = path.join(__dirname, "..", "browser-data");
const SCHEDULE_URL = "https://www.solidcore.co/auth/schedule";

(async () => {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║          KK Booking Bot — Login Session          ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();
  console.log(`Session data: ${USER_DATA_DIR}`);
  console.log();

  let context;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      args: [
        "--disable-blink-features=AutomationControlled",
      ],
    });
  } catch (err) {
    if (err.message.includes("lock")) {
      console.error("ERROR: browser-data/ is locked by another process.");
      console.error("Close any other browser instances using that directory and try again.");
      process.exit(1);
    }
    throw err;
  }

  const page = context.pages()[0] || (await context.newPage());

  console.log("Navigating to Solid Core schedule page...\n");
  await page.goto(SCHEDULE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}\n`);

  // Detect login state — solidcore redirects to a login page if unauthenticated,
  // or keeps you on /auth/schedule if the session is valid.
  const isOnSchedule = currentUrl.includes("/auth/schedule");

  // Also check for visible schedule elements as a stronger signal
  let hasScheduleContent = false;
  try {
    hasScheduleContent = await page.locator('[class*="schedule"], [class*="calendar"], [data-testid*="schedule"]').first().isVisible({ timeout: 3000 });
  } catch {
    // Element not found, that's fine
  }

  if (isOnSchedule && hasScheduleContent) {
    console.log("✅ ALREADY LOGGED IN");
    console.log("Session is valid! The booking bot can reuse this session.");
    console.log();
    console.log("You can close this browser (Ctrl+C) or browse around to verify.");
  } else if (isOnSchedule) {
    console.log("🔄 Page loaded but schedule content not detected yet.");
    console.log("This might mean:");
    console.log("  - The page is still loading (wait a moment)");
    console.log("  - You need to log in (check the browser window)");
    console.log();
    console.log("If you see a login form, complete the login + SMS verification.");
    console.log("Once you see the class schedule, press Ctrl+C to save the session.");
  } else {
    console.log("🔑 NOT LOGGED IN");
    console.log();
    console.log("Steps:");
    console.log("  1. In the browser window, enter your email and password");
    console.log("  2. Complete SMS verification when prompted");
    console.log("  3. Wait until you see the class schedule page");
    console.log("  4. Come back here and press Ctrl+C to save the session");
    console.log();
  }

  console.log("─────────────────────────────────────────────────");
  console.log("Browser is open. Press Ctrl+C when done to save session.");
  console.log("─────────────────────────────────────────────────");

  // Keep the process alive until Ctrl+C
  const shutdown = async () => {
    console.log("\n💾 Saving session and closing browser...");
    try {
      await context.close();
    } catch {
      // Browser may already be closed
    }
    console.log("✅ Session saved to browser-data/");
    console.log("You can now run: npm run arm");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Also handle the browser being closed manually
  context.on("close", () => {
    console.log("\nBrowser was closed manually.");
    console.log("✅ Session saved to browser-data/");
    process.exit(0);
  });
})().catch((err) => {
  console.error("\n❌ Login failed:", err.message);
  process.exit(1);
});
