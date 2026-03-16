// src/notify.js
//
// PURPOSE: After all booking agents finish, compile and display results.
// Outputs a formatted console table and writes a timestamped log file.
//
// USAGE: Called by orchestrator.js after all agents complete.
//   const { printResults, writeLogFile } = require("./notify");
//   printResults(results);
//   writeLogFile(results);

const fs = require("fs");
const path = require("path");

const LOGS_DIR = path.join(__dirname, "..", "logs");

// ── Status emoji mapping ─────────────────────────────────────────────────────

const STATUS_EMOJI = {
  booked: "✅",
  waitlisted: "⏳",
  no_class: "🚫",
  dry_run: "🧪",
  failed: "❌",
};

// ── Console output ───────────────────────────────────────────────────────────

/**
 * Print a formatted results summary to the console.
 *
 * @param {Array<{ status: string, message: string, booking: object }>} results
 */
function printResults(results) {
  console.log();
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║             Booking Results Summary               ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();

  if (!results || results.length === 0) {
    console.log("  No results to display.");
    return;
  }

  // Summary counts
  const booked = results.filter((r) => r.status === "booked").length;
  const waitlisted = results.filter((r) => r.status === "waitlisted").length;
  const noClass = results.filter((r) => r.status === "no_class").length;
  const dryRun = results.filter((r) => r.status === "dry_run").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log(`  ✅ Booked:      ${booked}`);
  console.log(`  ⏳ Waitlisted:  ${waitlisted}`);
  console.log(`  🚫 No class:    ${noClass}`);
  if (dryRun > 0) console.log(`  🧪 Dry run:     ${dryRun}`);
  console.log(`  ❌ Failed:      ${failed}`);
  console.log();

  // Detailed table
  console.log("  ┌─────┬──────────────┬────────────┬───────────────────────┬──────────────────────────────────────────────┐");
  console.log("  │  #  │    Status     │    Date    │      Time / Type      │  Message                                     │");
  console.log("  ├─────┼──────────────┼────────────┼───────────────────────┼──────────────────────────────────────────────┤");

  results.forEach((result, i) => {
    const booking = result.booking || {};
    const num = String(i + 1).padStart(2);
    const emoji = STATUS_EMOJI[result.status] || "❓";
    const status = `${emoji} ${(result.status || "unknown").padEnd(10)}`;
    const date = (booking.date || "—").padEnd(10);
    const timeType = `${booking.time_start || "??"}–${booking.time_end || "??"} ${booking.class_type || ""}`.trim().padEnd(21);
    const message = (result.message || "").slice(0, 44).padEnd(44);

    console.log(`  │ ${num}  │ ${status} │ ${date} │ ${timeType} │ ${message} │`);
  });

  console.log("  └─────┴──────────────┴────────────┴───────────────────────┴──────────────────────────────────────────────┘");
  console.log();

  // Detailed per-booking info (for classes with instructor/location context)
  results.forEach((result, i) => {
    const booking = result.booking || {};
    const emoji = STATUS_EMOJI[result.status] || "❓";
    console.log(`  ${emoji} Booking ${i + 1}:`);
    if (booking.location) console.log(`     Location:   ${booking.location}`);
    if (booking.date) console.log(`     Date:       ${booking.date}`);
    if (booking.time_start) console.log(`     Time:       ${booking.time_start}–${booking.time_end}`);
    if (booking.class_type) console.log(`     Class:      ${booking.class_type}`);
    if (booking.instructor_preference) console.log(`     Instructor: ${booking.instructor_preference}`);
    console.log(`     Status:     ${result.status}`);
    console.log(`     Message:    ${result.message}`);
    console.log();
  });
}

// ── Log file output ──────────────────────────────────────────────────────────

/**
 * Write results to a timestamped log file in the logs/ directory.
 *
 * @param {Array<{ status: string, message: string, booking: object }>} results
 * @returns {string|null} Path to the log file, or null if writing failed
 */
function writeLogFile(results) {
  try {
    // Ensure logs directory exists
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `booking-results-${timestamp}.json`;
    const filepath = path.join(LOGS_DIR, filename);

    const logData = {
      timestamp: now.toISOString(),
      timestamp_local: now.toLocaleString(),
      total_bookings: results.length,
      summary: {
        booked: results.filter((r) => r.status === "booked").length,
        waitlisted: results.filter((r) => r.status === "waitlisted").length,
        no_class: results.filter((r) => r.status === "no_class").length,
        failed: results.filter((r) => r.status === "failed").length,
      },
      results: results.map((r, i) => ({
        index: i + 1,
        status: r.status,
        message: r.message,
        booking: r.booking || {},
      })),
    };

    fs.writeFileSync(filepath, JSON.stringify(logData, null, 2), "utf-8");
    console.log(`📄 Log saved to: ${filepath}`);

    // Also write a human-readable text version
    const textFilename = `booking-results-${timestamp}.txt`;
    const textFilepath = path.join(LOGS_DIR, textFilename);
    const textContent = formatTextLog(logData);
    fs.writeFileSync(textFilepath, textContent, "utf-8");
    console.log(`📄 Text log saved to: ${textFilepath}`);

    return filepath;
  } catch (err) {
    console.error(`⚠️  Could not write log file: ${err.message}`);
    return null;
  }
}

/**
 * Format results as a human-readable text string.
 */
function formatTextLog(logData) {
  const lines = [];
  lines.push("KK Booking Bot — Results");
  lines.push("========================");
  lines.push(`Time: ${logData.timestamp_local}`);
  lines.push(`Total: ${logData.total_bookings} booking(s)`);
  lines.push(`Booked: ${logData.summary.booked} | Waitlisted: ${logData.summary.waitlisted} | No class: ${logData.summary.no_class || 0} | Failed: ${logData.summary.failed}`);
  lines.push("");

  logData.results.forEach((r) => {
    const booking = r.booking || {};
    const emoji = STATUS_EMOJI[r.status] || "?";
    lines.push(`${emoji} #${r.index} — ${r.status.toUpperCase()}`);
    if (booking.location) lines.push(`  Location:   ${booking.location}`);
    if (booking.date) lines.push(`  Date:       ${booking.date}`);
    if (booking.time_start) lines.push(`  Time:       ${booking.time_start}–${booking.time_end}`);
    if (booking.class_type) lines.push(`  Class:      ${booking.class_type}`);
    if (booking.instructor_preference) lines.push(`  Instructor: ${booking.instructor_preference}`);
    lines.push(`  Message:    ${r.message}`);
    lines.push("");
  });

  return lines.join("\n");
}

module.exports = { printResults, writeLogFile };
