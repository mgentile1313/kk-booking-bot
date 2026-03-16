// src/orchestrator.js
//
// PURPOSE: Read preferences.json, spawn one parallel booking agent per class,
// collect results, and pass them to notify.js for summary output.
//
// Each agent gets its own copy of browser-data/ to avoid Playwright lock
// conflicts when multiple persistent contexts run simultaneously.
//
// USAGE:
//   npm run book-now    — runs immediately (for testing)
//   Called by scheduler.js at T-0

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { bookClass, bookingLabel } = require("./agent");
const { printResults, writeLogFile } = require("./notify");

const PREFS_PATH = path.join(__dirname, "..", "preferences.json");
const USER_DATA_DIR = path.join(__dirname, "..", "browser-data");

/**
 * Copy a directory recursively (sync).
 * We use this instead of fs.cpSync for broader Node compat,
 * but fs.cpSync works on Node 16.7+.
 */
function copyDirSync(src, dest) {
  if (typeof fs.cpSync === "function") {
    fs.cpSync(src, dest, { recursive: true });
    return;
  }
  // Manual fallback for older Node versions
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Create a temporary copy of browser-data/ for a single agent.
 * Returns the path to the temp directory.
 */
function createTempSession(agentIndex) {
  const tempDir = path.join(
    os.tmpdir(),
    `kk-bot-session-${agentIndex}-${Date.now()}`
  );
  console.log(`  Agent ${agentIndex + 1}: Copying session to ${tempDir}`);
  copyDirSync(USER_DATA_DIR, tempDir);
  return tempDir;
}

/**
 * Clean up a temporary session directory.
 */
function cleanupTempSession(tempDir) {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (err) {
    console.log(`  Warning: Could not clean up temp dir ${tempDir}: ${err.message}`);
  }
}

/**
 * Launch a Playwright persistent context from a given user data dir.
 */
async function launchContext(userDataDir) {
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

/**
 * Run a single booking agent end-to-end:
 * copy session → launch browser → book class → close → cleanup
 */
async function runAgent(booking, index, options = {}) {
  const label = bookingLabel(booking);
  console.log(`\nAgent ${index + 1} starting: ${label}`);

  let tempDir = null;
  let context = null;

  try {
    // Create isolated session copy
    tempDir = createTempSession(index);

    // Launch browser
    context = await launchContext(tempDir);
    console.log(`  Agent ${index + 1}: Browser launched.`);

    // Run the booking flow
    const result = await bookClass(context, booking, {
      dryRun: options.dryRun || false,
    });

    // Close the browser
    try {
      await context.close();
    } catch (_) {
      // May already be closed
    }

    return result;
  } catch (err) {
    console.error(`  Agent ${index + 1} ERROR: ${err.message}`);

    // Try to close the browser if it's open
    if (context) {
      try {
        await context.close();
      } catch (_) {}
    }

    return {
      status: "failed",
      message: err.message,
      booking,
    };
  } finally {
    // Clean up temp session
    if (tempDir) {
      cleanupTempSession(tempDir);
    }
  }
}

/**
 * Main orchestrator entry point.
 * Reads preferences, spawns all agents in parallel, collects results.
 */
async function orchestrate(options = {}) {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║        KK Booking Bot — Orchestrator             ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();

  // ── Read preferences ──
  if (!fs.existsSync(PREFS_PATH)) {
    console.error("❌ preferences.json not found. Create it first (or run the UI).");
    process.exit(1);
  }

  let prefs;
  try {
    prefs = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
  } catch (err) {
    console.error(`❌ Could not parse preferences.json: ${err.message}`);
    process.exit(1);
  }

  const bookings = prefs.bookings || [];
  if (bookings.length === 0) {
    console.error("❌ No bookings found in preferences.json.");
    process.exit(1);
  }

  // ── Validate session exists ──
  if (!fs.existsSync(USER_DATA_DIR)) {
    console.error("❌ browser-data/ not found. Run `npm run login` first.");
    process.exit(1);
  }

  // Sort by priority (lower = higher priority)
  const sorted = [...bookings].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  console.log(`📋 ${sorted.length} class(es) to book:\n`);
  sorted.forEach((b, i) => {
    console.log(`  ${i + 1}. ${bookingLabel(b)} (priority ${b.priority || "—"})`);
  });
  console.log();

  // ── Spawn all agents in parallel ──
  const startTime = Date.now();
  console.log(`🚀 Launching ${sorted.length} parallel booking agent(s)...\n`);

  const resultPromises = sorted.map((booking, index) =>
    runAgent(booking, index, { dryRun: options.dryRun || false })
  );

  const results = await Promise.allSettled(resultPromises);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱  All agents finished in ${elapsed}s\n`);

  // ── Process results ──
  const finalResults = results.map((r) => {
    if (r.status === "fulfilled") {
      return r.value;
    }
    return {
      status: "failed",
      message: r.reason?.message || "Unknown error",
      booking: {},
    };
  });

  // ── Print and log results ──
  printResults(finalResults);
  writeLogFile(finalResults);

  // Return results for programmatic use (e.g., from scheduler)
  return finalResults;
}

// ── CLI entry point ──
if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("🧪 DRY RUN MODE — will not click final confirmation.\n");
  }

  orchestrate({ dryRun })
    .then((results) => {
      const failed = results.filter((r) => r.status === "failed").length;
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("❌ Orchestrator crashed:", err);
      process.exit(1);
    });
}

module.exports = { orchestrate };
