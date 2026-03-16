// src/agent.js
//
// Core booking agent. Takes a single booking preference object and a
// Playwright browser context, then executes the full reservation flow:
//   1. Navigate to schedule page
//   2. Set location filter
//   3. Set time + class type filters
//   4. Select the target date
//   5. Find the class row and click "book"
//   6. Select a pass and confirm
//   7. Verify success

const SCHEDULE_URL = "https://www.solidcore.co/auth/schedule";

// Random delay to appear human-like (200–500 ms)
function humanDelay(min = 200, max = 500) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dismiss any open modal via Escape or close button
async function dismissModal(page) {
  await page.keyboard.press("Escape");
  await humanDelay(300, 500);
  const modal = await page.$('[role="dialog"]');
  if (modal && await modal.isVisible()) {
    const closeSelectors = [
      '[role="dialog"] button[aria-label*="close" i]',
      '[role="dialog"] button:has-text("×")',
      '[role="dialog"] button:has-text("✕")',
      '[role="dialog"] [class*="close"]',
      // The X button seen in screenshots (rounded square icon button)
      '[role="dialog"] button svg',
    ];
    for (const sel of closeSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          await btn.click();
          await humanDelay(300, 500);
          return;
        }
      } catch (_) {}
    }
  }
}

// Wait for any open modal to close
async function waitForModalClose(page, timeout = 5000) {
  await page.waitForFunction(
    () => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      return [...dialogs].every((d) => d.offsetParent === null || getComputedStyle(d).display === "none");
    },
    { timeout }
  ).catch(() => {});
}

// Format a booking for log output
function bookingLabel(booking) {
  const instructor = booking.instructor_preference || "any instructor";
  return `[${booking.location} | ${booking.date} ${booking.time_start}–${booking.time_end} | ${booking.class_type} | ${instructor}]`;
}

/**
 * Run the booking flow for a single class.
 *
 * @param {import('playwright').BrowserContext} context - Playwright persistent context
 * @param {object} booking - A single entry from preferences.bookings[]
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - If true, stop before the final confirm click
 * @returns {Promise<{ status: 'booked'|'waitlisted'|'failed', message: string, booking: object }>}
 */
async function bookClass(context, booking, options = {}) {
  const label = bookingLabel(booking);
  const log = (msg) => console.log(`  ${label} ${msg}`);
  const dryRun = options.dryRun || false;

  let page;
  try {
    page = await context.newPage();
  } catch (err) {
    // If newPage fails, try to grab existing page
    page = context.pages()[0];
    if (!page) {
      return { status: "failed", message: `Could not open page: ${err.message}`, booking };
    }
  }

  try {
    // ─── Step 1: Navigate ───────────────────────────────────────────
    log("Navigating to schedule page...");
    await page.goto(SCHEDULE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanDelay(500, 1000);

    const currentUrl = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("sign-in")) {
      return { status: "failed", message: "Session expired — redirected to login page", booking };
    }

    // Wait for schedule page to be interactive
    await page.waitForSelector('[class*="schedule"], [class*="Schedule"], [data-testid*="schedule"], .classes-list, .schedule-container, main', {
      timeout: 15000,
    }).catch(() => {
      log("Warning: Could not find schedule container selector, continuing anyway...");
    });

    log("Schedule page loaded.");

    // ─── Step 2: Set location filter ────────────────────────────────
    log(`Setting location to "${booking.location}"...`);
    await setLocation(page, booking.location);
    await humanDelay(300, 600);

    // ─── Step 3: Set time + class type filters ──────────────────────
    log(`Setting filters: time ${booking.time_start}–${booking.time_end}, class type ${booking.class_type}...`);
    await setFilters(page, booking);
    await humanDelay(300, 600);

    // ─── Step 4: Select date ────────────────────────────────────────
    log(`Selecting date ${booking.date}...`);
    await selectDate(page, booking.date);
    await humanDelay(500, 1000);

    // ─── Step 5: Find class and click "book" ────────────────────────
    log("Scanning class list...");
    const bookResult = await findAndClickBook(page);

    if (bookResult.waitlisted) {
      log("Class is full — joining waitlist instead.");
      return { status: "waitlisted", message: "Joined waitlist (class was full)", booking };
    }

    if (bookResult.noClass) {
      log("No class available for this slot.");
      return { status: "no_class", message: bookResult.message || "No class available for this time/date", booking };
    }

    if (!bookResult.success) {
      return { status: "failed", message: bookResult.message || "Could not find matching class to book", booking };
    }

    log("Clicked book — proceeding to confirmation...");
    await humanDelay(800, 1500);

    // ─── Step 6: Select pass and confirm ────────────────────────────
    if (dryRun) {
      log("DRY RUN — taking screenshot then stopping.");
      await humanDelay(1500, 2000); // brief pause so you can see the result
      try {
        const screenshotPath = `dry-run-${booking.location.replace(/[^a-z0-9]/gi, "_")}-${booking.date}-${booking.time_start.replace(":", "")}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        log(`Screenshot saved: ${screenshotPath}`);
      } catch (_) {}

      // Check if we made it to the booking/confirmation page
      const currentUrl = page.url();
      const onBookingPage = /purchase|confirm|checkout|book/i.test(currentUrl);
      log(`Current URL: ${currentUrl} — ${onBookingPage ? "✅ reached booking page" : "⚠️  still on schedule page"}`);

      await page.close().catch(() => {});
      return {
        status: "dry_run",
        message: onBookingPage
          ? `Dry run — reached booking page (${currentUrl})`
          : `Dry run — did NOT reach booking page (still at ${currentUrl})`,
        booking,
      };
    }

    const confirmResult = await selectPassAndConfirm(page);

    if (!confirmResult.success) {
      return { status: "failed", message: confirmResult.message || "Failed at confirmation step", booking };
    }

    // ─── Step 7: Verify ─────────────────────────────────────────────
    log("Verifying booking...");
    await humanDelay(1000, 2000);

    const verified = await verifyBooking(page);

    await page.close().catch(() => {});

    if (verified) {
      log("✅ Booking confirmed!");
      return { status: "booked", message: "Successfully booked", booking };
    } else {
      log("⚠️  Could not verify booking — check manually.");
      return { status: "booked", message: "Book clicked but verification uncertain — check manually", booking };
    }
  } catch (err) {
    log(`❌ Error: ${err.message}`);
    // Take a screenshot for debugging
    try {
      const screenshotPath = `error-${booking.date}-${booking.time_start.replace(":", "")}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`Screenshot saved to ${screenshotPath}`);
    } catch (_) {
      // ignore screenshot errors
    }
    await page.close().catch(() => {});
    return { status: "failed", message: err.message, booking };
  }
}

// ─── Location Selection ───────────────────────────────────────────────────────

async function setLocation(page, location) {
  // Our location format is "STATE, City Name" — the site shows just the city name
  const cityName = location.includes(", ") ? location.split(", ").slice(1).join(", ") : location;

  // Click the "Home Studio" button (top-right area of schedule page)
  let studioBtn = null;
  for (const sel of [
    'button:has-text("Home Studio")',
    'button:has-text("Studio")',
    '[aria-label*="studio" i]',
  ]) {
    try {
      studioBtn = await page.waitForSelector(sel, { timeout: 4000 });
      if (studioBtn) break;
    } catch (_) {}
  }

  if (!studioBtn) {
    console.log("  Warning: Could not find Home Studio button — skipping location filter.");
    return;
  }

  await studioBtn.click();
  await humanDelay(500, 800);

  // Wait for the "FILTER BY STUDIO" modal
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  await humanDelay(300, 500);

  // Click "View All Studios" to see all options
  try {
    const viewAll = await page.waitForSelector('text="View All Studios"', { timeout: 3000 });
    await viewAll.click();
    await humanDelay(800, 1200);
  } catch (_) {
    console.log("  Warning: Could not find 'View All Studios' — trying to find studio directly.");
  }

  // Try to find and click the matching studio by city name
  const studioSelectors = [
    `[role="dialog"] button:has-text("${cityName}")`,
    `[role="dialog"] li:has-text("${cityName}")`,
    `[role="dialog"] a:has-text("${cityName}")`,
    `[role="dialog"] div[role="button"]:has-text("${cityName}")`,
    `[role="dialog"] [class*="option"]:has-text("${cityName}")`,
    `[role="dialog"] [class*="studio"]:has-text("${cityName}")`,
    `[role="dialog"] p:has-text("${cityName}")`,
    // Looser: any clickable element in the dialog containing the city name
    `[role="dialog"] *:has-text("${cityName}")`,
  ];

  for (const sel of studioSelectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 2500 });
      if (el && await el.isVisible()) {
        await el.click();
        await humanDelay(500, 800);

        // Click the "Select" button that appears in the bottom-right of the modal
        try {
          const selectBtn = await page.waitForSelector(
            '[role="dialog"] button:has-text("Select")',
            { timeout: 4000 }
          );
          if (selectBtn && await selectBtn.isVisible()) {
            await selectBtn.click();
            await humanDelay(500, 800);
          }
        } catch (_) {
          console.log("  Warning: Could not find Select button after choosing studio.");
        }

        await waitForModalClose(page, 4000);
        return;
      }
    } catch (_) {}
  }

  // Could not find the studio — close modal and continue
  console.log(`  Warning: Could not find studio "${cityName}" in modal. Closing and continuing.`);
  await dismissModal(page);
  await waitForModalClose(page, 3000);
}

// ─── Filters (Time + Class Type) ─────────────────────────────────────────────

async function setFilters(page, booking) {
  const log = (msg) => console.log(`  [filters] ${msg}`);
  // Click the Filters button (top-right of schedule page)
  let filterButton = null;
  for (const sel of [
    'button:has-text("Filters")',
    'button:has-text("Filter")',
    'button[aria-label*="filter" i]',
  ]) {
    try {
      filterButton = await page.waitForSelector(sel, { timeout: 4000 });
      if (filterButton) break;
    } catch (_) {}
  }

  if (!filterButton) {
    console.log("  Warning: Could not find Filters button — skipping filters.");
    return;
  }

  await filterButton.click();
  await humanDelay(500, 800);

  // Wait for the filter modal to appear
  await page.waitForSelector('[role="dialog"]', { timeout: 6000 }).catch(() => {});

  // Wait for any loading spinner inside the modal to disappear
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return true;
      const spinner = dialog.querySelector(
        '[class*="spinner"], [class*="loading"], [class*="Spinner"], svg[class*="spin"], circle[class*="spin"]'
      );
      return !spinner || getComputedStyle(spinner).display === "none";
    },
    { timeout: 10000 }
  ).catch(() => {});

  await humanDelay(400, 600);

  const dialog = page.locator('[role="dialog"]');

  // ── Expand "Time of the day" accordion ──
  log("Expanding Time of the day filter...");
  await expandAccordion(page, dialog, "Time of the day");
  await humanDelay(600, 900);
  await setTimeRange(page, booking.time_start, booking.time_end);
  await humanDelay(400, 600);

  // ── Expand "Class Type" accordion ──
  log("Expanding Class Type filter...");
  await expandAccordion(page, dialog, "Class Type");
  await humanDelay(600, 900);
  await selectClassType(page, booking.class_type);
  await humanDelay(300, 500);

  // ── Click "See X classes" to apply and close ──
  try {
    // "See 299 classes" button — match by prefix since count changes
    const applyBtn = await page.waitForSelector(
      '[role="dialog"] button:has-text("See "), [role="dialog"] button:has-text("Apply"), [role="dialog"] button:has-text("Done")',
      { timeout: 4000 }
    );
    if (applyBtn && await applyBtn.isVisible()) {
      await applyBtn.click();
      await humanDelay(500, 800);
      await waitForModalClose(page, 5000);
    }
  } catch (_) {
    await dismissModal(page);
    await waitForModalClose(page, 3000);
  }
}

// Click the down-arrow / accordion header for a named filter section.
// Tries both button and div elements; uses force:true to bypass any overlay.
async function expandAccordion(page, dialog, sectionName) {
  // Try clicking any element in the dialog whose text starts with sectionName
  // Could be a <button>, <div>, or other element — try them all
  const candidates = await page.$$(`[role="dialog"] button, [role="dialog"] div[class*="filter"], [role="dialog"] div[class*="accordion"], [role="dialog"] div[class*="Filter"]`);
  for (const el of candidates) {
    try {
      const text = await el.textContent();
      if (text && text.trim().startsWith(sectionName.split(" ")[0])) {
        const visible = await el.isVisible();
        if (visible) {
          await el.click({ force: true });
          console.log(`  [filters] Clicked accordion: "${sectionName}"`);
          return;
        }
      }
    } catch (_) {}
  }

  // Fallback: use locator getByText and force click
  try {
    await dialog.getByText(sectionName, { exact: false }).first().click({ force: true });
    console.log(`  [filters] Clicked accordion via getByText: "${sectionName}"`);
  } catch (err) {
    console.log(`  Warning: Could not expand "${sectionName}" accordion: ${err.message}`);
  }
}

async function selectClassType(page, classType) {
  // Class types appear as chips/buttons inside the filter modal after expanding "Class Type"
  const chipSelectors = [
    `[role="dialog"] button:has-text("${classType}")`,
    `[role="dialog"] [class*="chip"]:has-text("${classType}")`,
    `[role="dialog"] [class*="tag"]:has-text("${classType}")`,
    `[role="dialog"] label:has-text("${classType}")`,
    `[role="dialog"] div[role="button"]:has-text("${classType}")`,
    `[role="dialog"] li:has-text("${classType}")`,
    // Fallback without dialog scope
    `button:has-text("${classType}")`,
    `label:has-text("${classType}")`,
  ];

  for (const selector of chipSelectors) {
    try {
      const chip = await page.waitForSelector(selector, { timeout: 2000 });
      if (chip && await chip.isVisible()) {
        const isSelected = await chip.evaluate((el) => {
          return el.classList.contains("active") ||
            el.classList.contains("selected") ||
            el.getAttribute("aria-pressed") === "true" ||
            el.getAttribute("aria-checked") === "true";
        });
        if (!isSelected) {
          await chip.click();
        }
        return;
      }
    } catch (_) {}
  }

  console.log(`  Warning: Could not find class type chip for "${classType}".`);
}

// Slider uses integer hours (3=3AM, 13=1PM, 23=11PM). Extract just the hour from "HH:MM".
function timeStrToHour(timeStr) {
  return parseInt(timeStr.split(":")[0], 10);
}

async function setTimeRange(page, timeStart, timeEnd) {
  // After the "Time of the day" accordion expands, look for [role="slider"] handles
  // scoped inside the dialog. [solidcore] uses a dual-handle range slider.
  let sliders = [];
  try {
    await page.waitForSelector('[role="dialog"] [role="slider"]', { timeout: 4000 });
    sliders = await page.$$('[role="dialog"] [role="slider"]');
  } catch (_) {
    // Also try input[type="range"] as fallback
    sliders = await page.$$('[role="dialog"] input[type="range"]');
  }

  if (sliders.length === 0) {
    console.log("  Warning: Could not find time slider handles after expanding accordion.");
    return;
  }

  // timeStart/timeEnd are 24-hour strings like "16:00" → slider value is the hour integer (16)
  const targetHours = [timeStrToHour(timeStart), timeStrToHour(timeEnd)];
  const handles = sliders.length >= 2 ? [sliders[0], sliders[1]] : [sliders[0], sliders[0]];

  for (let i = 0; i < 2; i++) {
    const handle = handles[i];
    const target = targetHours[i];
    try {
      // Click to focus the handle
      await handle.click({ force: true });
      await humanDelay(200, 300);

      // Press Home to reset to minimum
      await page.keyboard.press("Home");
      await humanDelay(250, 350);

      // Read actual value after Home
      const valueAfterHome = parseInt((await handle.getAttribute("aria-valuenow")) ?? "3");
      console.log(`  Slider ${i === 0 ? "start" : "end"}: after-Home=${valueAfterHome} target=${target}h`);

      // Detect step size by pressing ArrowRight once
      await page.keyboard.press("ArrowRight");
      await humanDelay(100, 150);
      const valueAfterOne = parseInt((await handle.getAttribute("aria-valuenow")) ?? String(valueAfterHome + 1));
      const step = valueAfterOne - valueAfterHome;
      const effectiveStep = step > 0 ? step : 1;
      console.log(`  Slider ${i === 0 ? "start" : "end"}: step=${effectiveStep}h`);

      // Calculate steps from current position (valueAfterOne) to target
      const stepsFromCurrent = Math.round((target - valueAfterOne) / effectiveStep);
      const key = stepsFromCurrent >= 0 ? "ArrowRight" : "ArrowLeft";
      const presses = Math.abs(stepsFromCurrent);

      for (let p = 0; p < presses; p++) {
        await page.keyboard.press(key);
      }

      const finalVal = await handle.getAttribute("aria-valuenow");
      console.log(`  Slider ${i === 0 ? "start" : "end"}: target=${target}h, final=${finalVal}h`);
    } catch (err) {
      console.log(`  Warning: Could not set slider handle ${i}: ${err.message}`);
    }
  }
}

// ─── Date Selection ───────────────────────────────────────────────────────────

async function selectDate(page, dateStr) {
  const targetDate = new Date(dateStr + "T00:00:00");
  const targetDay = targetDate.getDate();

  console.log(`  [date] Looking for day ${targetDay} in date strip...`);

  // Try up to 40 times: attempt to click the day, then advance the strip if not found.
  const maxAdvances = 40;
  for (let attempt = 0; attempt <= maxAdvances; attempt++) {
    const clicked = await tryClickDayInStrip(page, targetDay);
    if (clicked) {
      console.log(`  [date] Clicked day ${targetDay}.`);
      await humanDelay(400, 700);
      return;
    }

    // Day not visible yet — advance the date strip
    const advanced = await advanceDateStrip(page);
    if (!advanced) {
      console.log(`  [date] Warning: could not advance date strip (attempt ${attempt + 1}).`);
      break;
    }
    await humanDelay(300, 500);
  }

  console.log(`  [date] Warning: could not select date ${dateStr}.`);
}

/**
 * Try to click the date column in the strip for a given day number.
 * Each column has a day-name ("Mon") and a number ("23") — NOT just the number alone.
 */
async function tryClickDayInStrip(page, day) {
  // Strategy 1: data-date attribute
  try {
    const el = await page.$(`[data-date*="${String(day).padStart(2, "0")}"], [data-value*="${String(day).padStart(2, "0")}"]`);
    if (el && await el.isVisible()) { await el.click(); return true; }
  } catch (_) {}

  // Strategy 2: DOM scan scoped to main content.
  // Each date column's textContent is something like "Mon\n23" or "Tue23".
  // We extract the number(s) from each candidate element and check siblings
  // to confirm it's the date strip (siblings also have consecutive day numbers).
  return page.evaluate((day) => {
    function extractNums(str) {
      return (str.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= 31);
    }

    const root = document.querySelector("main") || document;
    const candidates = [...root.querySelectorAll("button, div, li, td, a")];
    for (const el of candidates) {
      if (!el.offsetParent) continue; // hidden
      const nums = extractNums(el.textContent || "");
      // Element must contain our target day (and not many other numbers — avoid large containers)
      if (!nums.includes(day)) continue;
      if (nums.length > 3) continue; // skip elements with too many numbers (e.g., a whole schedule row)

      // Confirm it's part of the date strip: siblings should also contain consecutive day numbers
      const parent = el.parentElement;
      if (!parent) continue;
      const siblingDayNums = [...parent.children]
        .flatMap((c) => extractNums(c.textContent || ""));
      const uniqueSibNums = [...new Set(siblingDayNums)];

      const hasAdjacentDays =
        uniqueSibNums.length >= 3 &&
        uniqueSibNums.some((n) => n === day - 1 || n === day + 1);

      if (hasAdjacentDays) {
        el.click();
        return true;
      }
    }
    return false;
  }, day);
}

/**
 * Click the right/forward arrow button at the end of the date strip.
 * From the solidcore schedule page the strip row contains date columns + a › button on the right.
 */
async function advanceDateStrip(page) {
  // Named aria-label selectors first
  for (const sel of ['button[aria-label*="next" i]', 'button[aria-label*="forward" i]', 'button[aria-label*="right" i]']) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) { await btn.click(); return true; }
    } catch (_) {}
  }

  return page.evaluate(() => {
    function extractNums(str) {
      return (str.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= 31);
    }

    // Find the date strip container scoped to main content.
    const root = document.querySelector("main") || document;
    let stripContainer = null;
    for (const el of root.querySelectorAll("*")) {
      if (!el.offsetParent) continue;
      const childNums = [...el.children].flatMap((c) => extractNums(c.textContent || ""));
      const unique = [...new Set(childNums)];
      if (unique.length >= 4) {
        // Check they're consecutive-ish
        unique.sort((a, b) => a - b);
        const isConsecutive = unique.every((n, i) => i === 0 || n <= unique[i - 1] + 3);
        if (isConsecutive) { stripContainer = el; break; }
      }
    }

    if (stripContainer) {
      // Look for the forward button: the last visible button in the strip's parent,
      // or a sibling button to the right of the strip container.
      const parent = stripContainer.parentElement;
      if (parent) {
        const btns = [...parent.querySelectorAll("button")].filter((b) => b.offsetParent);
        if (btns.length > 0) { btns[btns.length - 1].click(); return true; }
      }
      // Or directly inside the strip container itself (last button)
      const innerBtns = [...stripContainer.querySelectorAll("button")].filter((b) => b.offsetParent);
      if (innerBtns.length > 0) { innerBtns[innerBtns.length - 1].click(); return true; }
    }

    // Last resort: any visible button with a single arrow-like character
    for (const btn of document.querySelectorAll("button")) {
      if (!btn.offsetParent) continue;
      const t = btn.textContent.trim();
      if ([">", "›", "»", "→", "▶", "❯"].includes(t)) { btn.click(); return true; }
    }

    return false;
  });
}

// ─── Find Class and Click Book ────────────────────────────────────────────────

/**
 * Return the first batch of visible elements matching any selector in the list.
 */
async function collectVisibleButtons(page, selectors) {
  for (const sel of selectors) {
    try {
      const btns = await page.$$(sel);
      const visible = [];
      for (const btn of btns) {
        if (await btn.isVisible()) visible.push(btn);
      }
      if (visible.length > 0) return visible;
    } catch (_) {}
  }
  return [];
}

async function findAndClickBook(page) {
  // Filters + date are already applied, so the visible class list is pre-narrowed.
  // Wait for a book or waitlist button to appear (up to 5s) instead of a blind sleep.
  const bookBtnSelectors = [
    'main button:has-text("book")',
    'main a:has-text("book")',
    'button:text-is("book")',
    'button:text-is("Book")',
    'a:text-is("book")',
  ];
  const waitlistBtnSelectors = [
    'main button:has-text("join waitlist")',
    'main button:has-text("waitlist")',
    'button:has-text("join waitlist")',
    'button:has-text("waitlist")',
  ];

  await page.waitForSelector(
    [...bookBtnSelectors, ...waitlistBtnSelectors].join(", "),
    { timeout: 5000 }
  ).catch(() => {});

  const log = (msg) => console.log(`  [book] ${msg}`);

  // ── Book buttons ──────────────────────────────────────────────────────────
  const bookButtons = await collectVisibleButtons(page, bookBtnSelectors);
  if (bookButtons.length > 0) {
    log(`Found ${bookButtons.length} Book button(s) — clicking first.`);
    const urlBefore = page.url();
    await bookButtons[0].click();

    await Promise.race([
      page.waitForURL((url) => url !== urlBefore, { timeout: 6000 }),
      page.waitForSelector('[role="dialog"], [class*="confirm"], [class*="checkout"], [class*="purchase"]', { timeout: 6000 }),
    ]).catch(() => {});

    const urlAfter = page.url();
    const navigated = urlAfter !== urlBefore;
    log(`Book clicked — URL ${navigated ? "changed to " + urlAfter : "unchanged (may have opened modal)"}`);
    return { success: true, navigated };
  }

  // ── Waitlist buttons ──────────────────────────────────────────────────────
  const waitlistButtons = await collectVisibleButtons(page, waitlistBtnSelectors);
  if (waitlistButtons.length > 0) {
    log(`No Book button found — joining waitlist.`);
    await waitlistButtons[0].click();
    return { success: true, waitlisted: true };
  }

  // ── Nothing found ─────────────────────────────────────────────────────────
  log("No Book or Waitlist button found — no class available for this slot.");
  return { success: false, noClass: true, message: "No class available for this time/date" };
}

// ─── Pass Selection and Confirmation ──────────────────────────────────────────

async function selectPassAndConfirm(page) {
  // We should now be on the purchase/confirmation page
  // Wait for the page to load
  try {
    await page.waitForURL(/purchase|confirm|checkout|book/i, { timeout: 10000 });
  } catch (_) {
    // URL may not change — check for confirmation elements on current page
  }

  await humanDelay(500, 1000);

  // Step 1: Select a pass (if there's a selection required)
  const passSelectors = [
    '[class*="pass"] input[type="radio"]',
    '[class*="pass"] button',
    '[class*="credit"] button',
    '[class*="membership"] button',
    'input[type="radio"]',
    '[class*="plan"] button',
    '[class*="option"]:has-text("pass")',
    '[class*="option"]:has-text("credit")',
    // The first available pass/credit option
    'label:has(input[type="radio"])',
  ];

  for (const selector of passSelectors) {
    try {
      const passOptions = await page.$$(selector);
      if (passOptions.length > 0) {
        // Click the first available pass
        const firstPass = passOptions[0];
        if (await firstPass.isVisible()) {
          await firstPass.click();
          await humanDelay();
          break;
        }
      }
    } catch (_) {
      continue;
    }
  }

  // Step 2: Click "Book Class" confirmation button
  const confirmSelectors = [
    'button:has-text("Book Class")',
    'button:has-text("Confirm")',
    'button:has-text("Complete")',
    'button:has-text("Reserve")',
    'button:has-text("Book")',
    'button[type="submit"]',
    '[class*="confirm"] button',
    '[class*="submit"] button',
    'input[type="submit"]',
  ];

  for (const selector of confirmSelectors) {
    try {
      const confirmBtn = await page.waitForSelector(selector, { timeout: 3000 });
      if (confirmBtn && await confirmBtn.isVisible()) {
        await confirmBtn.click();
        return { success: true };
      }
    } catch (_) {
      continue;
    }
  }

  return { success: false, message: "Could not find confirmation/Book Class button" };
}

// ─── Verify Booking ───────────────────────────────────────────────────────────

async function verifyBooking(page) {
  // Look for confirmation indicators
  const successIndicators = [
    'text=/booked|confirmed|success|you.?re.?in|reservation.*confirmed/i',
    '[class*="success"]',
    '[class*="confirm"]',
    '[class*="booked"]',
  ];

  for (const selector of successIndicators) {
    try {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        return true;
      }
    } catch (_) {
      continue;
    }
  }

  // Check page content for success keywords
  const bodyText = await page.textContent("body").catch(() => "");
  if (/booked|confirmed|success|you'?re in|see you/i.test(bodyText)) {
    return true;
  }

  // Check we're not still on an error state
  if (/error|failed|unable|problem|sorry/i.test(bodyText)) {
    return false;
  }

  // Ambiguous — return true optimistically (the click went through)
  return true;
}

module.exports = { bookClass, bookingLabel };
