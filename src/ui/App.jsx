import React, { useState, useEffect } from "react";

const LOCATIONS = [
  "CA, La Jolla",
  "CA, Little Italy",
  "NY, East Village",
  "NY, Gramercy",
  "NY, Greenwich Village",
  "NY, Nomad",
];

const CLASS_TYPES = [
  "Signature50",
  "Power30",
  "Off-Peak Signature50",
  "Focus50",
  "Starter50",
  "Advanced50",
  "Off-Peak Starter50",
];

function getNextMonth23rd() {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  if (now.getDate() > 23) {
    month += 1;
  }
  if (month > 11) {
    month = 0;
    year += 1;
  }
  return new Date(year, month, 23).toISOString().slice(0, 10);
}

function formatScheduleDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}-12:00AM`;
}

/** Returns all Monday/Wednesday/Friday dates in the next calendar month as YYYY-MM-DD strings. */
function getNextMonthMWFDates() {
  const now = new Date();
  const nextMonth = now.getMonth() + 1;
  const year = nextMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
  const month = nextMonth > 11 ? 0 : nextMonth;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay(); // 1=Mon, 3=Wed, 5=Fri
    if (dow === 1 || dow === 3 || dow === 5) {
      dates.push(new Date(year, month, d).toISOString().slice(0, 10));
    }
  }
  return dates;
}

function defaultMWFBookings() {
  return getNextMonthMWFDates().map((date, i) => ({
    id: crypto.randomUUID?.() || String(Date.now()) + i,
    location: "NY, East Village",
    date,
    time_start: "07:00",
    time_end: "08:00",
    class_type: "Signature50",
    instructor_preference: null,
    priority: i + 1,
  }));
}

const emptyBooking = (priority = 1) => ({
  id: crypto.randomUUID?.() || String(Date.now()) + Math.random(),
  location: "NY, East Village",
  date: getNextMonthMWFDates()[0] || getNextMonth23rd(),
  time_start: "07:00",
  time_end: "08:00",
  class_type: "Signature50",
  instructor_preference: null,
  priority,
});

const TARGET_DATE = getNextMonth23rd();

export default function App() {
  const [bookings, setBookings] = useState(defaultMWFBookings());
  const [saveStatus, setSaveStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/preferences.json")
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => {
        if (data.bookings && data.bookings.length > 0) {
          setBookings(
            data.bookings.map((b, i) => ({
              ...b,
              id: crypto.randomUUID?.() || String(Date.now()) + i,
            }))
          );
        }
        setLoading(false);
      })
      .catch(() => { setBookings(defaultMWFBookings()); setLoading(false); });
  }, []);

  const updateBooking = (id, field, value) => {
    setBookings((prev) =>
      prev.map((b) => (b.id === id ? { ...b, [field]: value } : b))
    );
    setSaveStatus(null);
  };

  const addBooking = () => {
    const newBooking = emptyBooking(bookings.length + 1);
    setBookings((prev) => [...prev, newBooking]);
    setSaveStatus(null);
  };

  const removeBooking = (id) => {
    setBookings((prev) => {
      const filtered = prev.filter((b) => b.id !== id);
      // Re-number priorities
      return filtered.map((b, i) => ({ ...b, priority: i + 1 }));
    });
    setSaveStatus(null);
  };

  const moveBooking = (index, direction) => {
    setBookings((prev) => {
      const arr = [...prev];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= arr.length) return prev;
      [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
      return arr.map((b, i) => ({ ...b, priority: i + 1 }));
    });
    setSaveStatus(null);
  };

  const savePreferences = async () => {
    const payload = {
      target_date: TARGET_DATE,
      target_time: "00:00:00",
      bookings: bookings.map(({ id, ...rest }) => rest),
    };

    try {
      // Try saving via the dev server API (Vite proxy or direct)
      const res = await fetch("/api/save-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload, null, 2),
      });
      if (res.ok) {
        setSaveStatus("saved");
        return;
      }
    } catch {
      // API not available — fall back to clipboard
    }

    // Fallback: copy JSON to clipboard so user can paste it into preferences.json
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setSaveStatus("clipboard");
    } catch {
      // Final fallback: show in a prompt
      window.prompt(
        "Copy this JSON and save it as preferences.json:",
        JSON.stringify(payload, null, 2)
      );
      setSaveStatus("manual");
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.loadingText}>Loading preferences...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>[solidcore] Booking Bot</h1>
        <p style={styles.subtitle}>Set your class preferences for the next schedule drop</p>
      </header>

      {/* Schedule Drop + Set Preferences */}
      <section style={styles.card}>
        <div style={styles.scheduleSectionHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Schedule Drop</h2>
            <p style={styles.hint}>When does the next schedule go live?</p>
          </div>
          <div style={styles.scheduleRight}>
            <span style={styles.scheduleDate}>{formatScheduleDate(TARGET_DATE)}</span>
            <button onClick={savePreferences} style={styles.saveButton}>
              Set Preferences
            </button>
          </div>
        </div>

        {saveStatus === "saved" && (
          <p style={styles.savedBadge}>Saved to preferences.json</p>
        )}
        {saveStatus === "clipboard" && (
          <p style={styles.clipboardBadge}>Copied to clipboard — paste into preferences.json</p>
        )}
        {saveStatus === "manual" && (
          <p style={styles.clipboardBadge}>Copy the JSON from the dialog and save as preferences.json</p>
        )}
      </section>

      {/* Bookings */}
      <section style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Classes to Book</h2>
          <button onClick={addBooking} style={styles.addButton}>+ Add Class</button>
        </div>

        {bookings.map((booking, index) => (
          <div key={booking.id} style={styles.bookingCard}>
            <div style={styles.bookingHeader}>
              <div style={styles.bookingHeaderLeft}>
                <span style={styles.priorityBadge}>#{booking.priority}</span>
                <input
                  type="date"
                  value={booking.date}
                  onChange={(e) => updateBooking(booking.id, "date", e.target.value)}
                  style={{ ...styles.input, marginLeft: 12 }}
                />
              </div>
              <div style={styles.bookingActions}>
                <button
                  onClick={() => moveBooking(index, -1)}
                  disabled={index === 0}
                  style={styles.moveButton}
                  title="Move up"
                >▲</button>
                <button
                  onClick={() => moveBooking(index, 1)}
                  disabled={index === bookings.length - 1}
                  style={styles.moveButton}
                  title="Move down"
                >▼</button>
                {bookings.length > 1 && (
                  <button
                    onClick={() => removeBooking(booking.id)}
                    style={styles.removeButton}
                    title="Remove"
                  >✕</button>
                )}
              </div>
            </div>

            <div style={styles.fieldGrid}>
              <label style={styles.label}>
                Start Window
                <input
                  type="time"
                  value={booking.time_start}
                  onChange={(e) => updateBooking(booking.id, "time_start", e.target.value)}
                  style={styles.input}
                />
              </label>
              <label style={styles.label}>
                End Window
                <input
                  type="time"
                  value={booking.time_end}
                  onChange={(e) => updateBooking(booking.id, "time_end", e.target.value)}
                  style={styles.input}
                />
              </label>
              <label style={styles.label}>
                Location
                <select
                  value={booking.location}
                  onChange={(e) => updateBooking(booking.id, "location", e.target.value)}
                  style={styles.input}
                >
                  {LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </label>
              <label style={styles.label}>
                Class Type
                <select
                  value={booking.class_type}
                  onChange={(e) => updateBooking(booking.id, "class_type", e.target.value)}
                  style={styles.input}
                >
                  {CLASS_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
      </section>

      <footer style={styles.footer}>
        <p>
          After saving, run <code style={styles.code}>npm run login</code> on the evening of the
          22nd, then <code style={styles.code}>npm run arm</code> before bed.
        </p>
      </footer>
    </div>
  );
}

// ── App styles ─────────────────────────────────────────────────────────────────

const styles = {
  container: {
    maxWidth: 800,
    margin: "0 auto",
    padding: "24px 16px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    color: "#333333",
    background: "#f0f2f5",
    minHeight: "100vh",
  },
  header: {
    textAlign: "center",
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: 700,
    margin: "0 0 6px",
    color: "#2a4a6b",
  },
  subtitle: {
    fontSize: 14,
    color: "#7a9ab8",
    margin: 0,
  },
  card: {
    background: "#ffffff",
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
    border: "1px solid #d8e8f5",
    boxShadow: "0 1px 4px rgba(90,155,213,0.07)",
  },
  scheduleSectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scheduleRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  scheduleDate: {
    fontSize: 14,
    fontWeight: 600,
    color: "#5b9bd5",
    fontFamily: "monospace",
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: 600,
    margin: "0 0 4px",
    color: "#2a4a6b",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  hint: {
    fontSize: 13,
    color: "#7a9ab8",
    margin: 0,
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    fontSize: 13,
    fontWeight: 500,
    color: "#557799",
    gap: 4,
  },
  input: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #c5daf0",
    background: "#f7fafd",
    color: "#333",
    fontSize: 14,
    outline: "none",
  },
  bookingCard: {
    background: "#f7fafd",
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    border: "1px solid #d8e8f5",
  },
  bookingHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  bookingHeaderLeft: {
    display: "flex",
    alignItems: "center",
  },
  priorityBadge: {
    background: "#5b9bd5",
    color: "#fff",
    borderRadius: 6,
    padding: "3px 10px",
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  bookingActions: {
    display: "flex",
    gap: 6,
  },
  moveButton: {
    background: "transparent",
    border: "1px solid #c5daf0",
    borderRadius: 6,
    color: "#7a9ab8",
    cursor: "pointer",
    padding: "4px 8px",
    fontSize: 12,
  },
  removeButton: {
    background: "transparent",
    border: "1px solid #e0a0a8",
    borderRadius: 6,
    color: "#c0607a",
    cursor: "pointer",
    padding: "4px 8px",
    fontSize: 12,
  },
  addButton: {
    background: "#e8f1fb",
    color: "#2a6db5",
    border: "1px solid #c5daf0",
    borderRadius: 8,
    padding: "7px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  saveButton: {
    background: "#5b9bd5",
    color: "#fff",
    border: "none",
    borderRadius: 9,
    padding: "10px 24px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
  },
  savedBadge: {
    color: "#3a8a50",
    fontSize: 13,
    fontWeight: 600,
    margin: "0 0 12px",
  },
  clipboardBadge: {
    color: "#b07020",
    fontSize: 13,
    fontWeight: 600,
    margin: "0 0 12px",
  },
  footer: {
    textAlign: "center",
    color: "#999",
    fontSize: 13,
    borderTop: "1px solid #d8e8f5",
    paddingTop: 16,
  },
  code: {
    background: "#e8f1fb",
    padding: "2px 6px",
    borderRadius: 4,
    fontSize: 12,
    color: "#2a6db5",
  },
  loadingText: {
    textAlign: "center",
    color: "#7a9ab8",
  },
};
