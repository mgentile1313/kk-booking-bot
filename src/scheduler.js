// src/scheduler.js
//
// PURPOSE: Count down to the schedule drop time (23rd at 12:00 AM), then
// trigger the orchestrator. Keeps the Mac awake using `caffeinate`.
//
// USAGE: npm run arm
// Run this before bed on the evening of the 22nd. It will:
//   1. Read target_date + target_time from preferences.json
//   2. Spawn `caffeinate -i` to prevent the Mac from sleeping
//   3. Print a countdown every 30 seconds
//   4. At T-5 minutes, print a warning
//   5. At T-0, call the orchestrator
//
// The process must stay alive the entire time. Do NOT close the terminal.

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { orchestrate } = require("./orchestrator");

const PREFS_PATH = path.join(__dirname, "..", "preferences.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCountdown(ms) {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function loadPreferences() {
  if (!fs.existsSync(PREFS_PATH)) {
    console.error("❌ preferences.json not found. Create it first (or run the UI).");
    process.exit(1);
  }

  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
  } catch (err) {
    console.error(`❌ Could not parse preferences.json: ${err.message}`);
    process.exit(1);
  }
}

function getTargetTime(prefs) {
  const dateStr = prefs.target_date;
  const timeStr = prefs.target_time || "00:00:00";

  if (!dateStr) {
    console.error("❌ preferences.json is missing target_date.");
    process.exit(1);
  }

  // Parse as local time (the schedule drops at midnight local)
  const target = new Date(`${dateStr}T${timeStr}`);

  if (isNaN(target.getTime())) {
    console.error(`❌ Invalid target datetime: ${dateStr}T${timeStr}`);
    process.exit(1);
  }

  return target;
}

// ── Caffeinate (keep Mac awake) ──────────────────────────────────────────────

function startCaffeinate() {
  try {
    const proc = spawn("caffeinate", ["-i"], {
      stdio: "ignore",
      detached: false,
    });

    proc.on("error", (err) => {
      console.log(`⚠️  caffeinate not available (${err.message}). Mac may sleep.`);
      console.log("   Tip: keep the lid open and disable sleep in System Settings.\n");
    });

    proc.unref(); // Don't let caffeinate keep Node alive if we exit

    return proc;
  } catch (err) {
    console.log(`⚠️  Could not start caffeinate: ${err.message}`);
    return null;
  }
}

function stopCaffeinate(proc) {
  if (proc && !proc.killed) {
    try {
      proc.kill();
    } catch (_) {
      // Already dead
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║           KK Booking Bot — Scheduler             ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();

  // Load config
  const prefs = loadPreferences();
  const target = getTargetTime(prefs);
  const bookingCount = (prefs.bookings || []).length;

  console.log(`🎯 Target time : ${target.toLocaleString()}`);
  console.log(`📋 Bookings    : ${bookingCount} class(es) queued`);
  console.log();

  // Check if target is in the past
  const now = Date.now();
  const msUntilTarget = target.getTime() - now;

  if (msUntilTarget <= 0) {
    console.log("⚠️  Target time is in the past!");
    console.log("   Running orchestrator immediately...\n");
    await orchestrate();
    return;
  }

  // Validate session exists
  const sessionDir = path.join(__dirname, "..", "browser-data");
  if (!fs.existsSync(sessionDir)) {
    console.error("❌ browser-data/ not found. Run `npm run login` first.");
    process.exit(1);
  }

  console.log(`⏳ Time until drop: ${formatCountdown(msUntilTarget)}`);
  console.log();

  // Start caffeinate to keep the Mac awake
  console.log("☕ Starting caffeinate (preventing sleep)...");
  const caffeinateProc = startCaffeinate();
  if (caffeinateProc && !caffeinateProc.killed) {
    console.log("☕ caffeinate running — Mac will stay awake.\n");
  }

  console.log("─────────────────────────────────────────────────");
  console.log("Keep this terminal open. Do NOT close the lid.");
  console.log("─────────────────────────────────────────────────\n");

  let fiveMinWarningPrinted = false;
  let oneMinWarningPrinted = false;

  // ── Countdown loop (every 30 seconds) ──
  const countdownInterval = setInterval(() => {
    const remaining = target.getTime() - Date.now();

    if (remaining <= 0) {
      // Should not happen (setTimeout fires first), but just in case
      clearInterval(countdownInterval);
      return;
    }

    const timeStr = formatCountdown(remaining);
    const timestamp = new Date().toLocaleTimeString();

    // T-5 minutes warning
    if (remaining <= 5 * 60 * 1000 && !fiveMinWarningPrinted) {
      fiveMinWarningPrinted = true;
      console.log();
      console.log("🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥");
      console.log("🔥  FIVE MINUTES until schedule drop!              🔥");
      console.log("🔥  Browsers will launch soon. Do not disturb.     🔥");
      console.log("🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥");
      console.log();
    }

    // T-1 minute warning
    if (remaining <= 60 * 1000 && !oneMinWarningPrinted) {
      oneMinWarningPrinted = true;
      console.log("⚡ ONE MINUTE — GO TIME IMMINENT");
      console.log();
    }

    // Regular countdown (every 30s, or every 10s in the last 5 minutes)
    const isLastStretch = remaining <= 5 * 60 * 1000;
    // This runs every 30s from the interval, so in the last stretch we just print every tick
    console.log(`  [${timestamp}] ${timeStr} remaining...`);
  }, 30000);

  // Also print more frequently in the last 5 minutes
  const fastCountdownTimeout = setTimeout(() => {
    // Switch to 10-second updates for the final stretch
    const fastInterval = setInterval(() => {
      const remaining = target.getTime() - Date.now();
      if (remaining <= 0) {
        clearInterval(fastInterval);
        return;
      }
      const timeStr = formatCountdown(remaining);
      const timestamp = new Date().toLocaleTimeString();
      console.log(`  [${timestamp}] ${timeStr} remaining...`);
    }, 10000);

    // Clean up the fast interval when target is reached
    setTimeout(() => clearInterval(fastInterval), Math.max(0, target.getTime() - Date.now()) + 1000);
  }, Math.max(0, msUntilTarget - 5 * 60 * 1000));

  // ── Main timer — fire at exactly T-0 ──
  const mainTimeout = setTimeout(async () => {
    clearInterval(countdownInterval);
    clearTimeout(fastCountdownTimeout);

    console.log();
    console.log("🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨");
    console.log("🚨              SCHEDULE DROP — GO GO GO!             🚨");
    console.log("🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨");
    console.log();
    console.log(`Triggered at: ${new Date().toLocaleString()}`);
    console.log();

    try {
      const results = await orchestrate();
      const failed = (results || []).filter((r) => r.status === "failed").length;
      const booked = (results || []).filter((r) => r.status === "booked").length;
      const waitlisted = (results || []).filter((r) => r.status === "waitlisted").length;

      console.log();
      console.log("═══════════════════════════════════════════════════");
      console.log(`  FINAL: ${booked} booked, ${waitlisted} waitlisted, ${failed} failed`);
      console.log("═══════════════════════════════════════════════════");
    } catch (err) {
      console.error(`\n❌ Orchestrator error: ${err.message}`);
      console.error(err.stack);
    } finally {
      stopCaffeinate(caffeinateProc);
      console.log("\n☕ caffeinate stopped. Mac can sleep now.");
      console.log("Done. Check results above or see the log file.");
      process.exit(0);
    }
  }, msUntilTarget);

  // ── Graceful shutdown ──
  const shutdown = () => {
    console.log("\n\n⚠️  Scheduler interrupted (Ctrl+C).");
    clearInterval(countdownInterval);
    clearTimeout(mainTimeout);
    clearTimeout(fastCountdownTimeout);
    stopCaffeinate(caffeinateProc);
    console.log("☕ caffeinate stopped.");
    console.log("Scheduler exited. No bookings were made.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Print initial countdown tick immediately
  const initialRemaining = target.getTime() - Date.now();
  const timestamp = new Date().toLocaleTimeString();
  console.log(`  [${timestamp}] ${formatCountdown(initialRemaining)} remaining...`);
}

// ── Entry point ──
main().catch((err) => {
  console.error("❌ Scheduler crashed:", err);
  process.exit(1);
});
