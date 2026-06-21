import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Trip configuration and exchange rates. @constant */
const TRIP_CONFIG = {
  totalBudgetEUR: 1802,
  spentFixed: 1390.05,
  summaryHour: 21,
  exchangeRate: { eurToIdr: 20818 },
};

/** Expense categories. @constant */
const CATEGORIES = {
  transport:  { label: "Transport",    icon: "🚇", color: "#38bdf8" },
  lunch:      { label: "Makan Siang",  icon: "🥗", color: "#34d399" },
  dinner:     { label: "Makan Malam",  icon: "🍽️", color: "#a78bfa" },
  snack:      { label: "Jajan/Kopi",   icon: "☕", color: "#f59e0b" },
  flight:     { label: "Penerbangan",  icon: "✈️", color: "#fb7185" },
  lodging:    { label: "Lodging",      icon: "🏨", color: "#60a5fa" },
  boarding:   { label: "Boarding",     icon: "🍴", color: "#facc15" },
  telephone:  { label: "Telephone",    icon: "📞", color: "#22d3ee" },
  taxi:       { label: "Taxi",         icon: "🚕", color: "#fbbf24" },
  conveyance: { label: "Conveyance",   icon: "🚙", color: "#c084fc" },
  others:     { label: "Others",       icon: "📝", color: "#f472b6", requiresSpecify: true },
  other:      { label: "Lainnya",      icon: "📦", color: "#94a3b8" },
};

/** Supported currencies. @constant */
const CURRENCIES = {
  EUR: { symbol: "€",  label: "EUR", flag: "🇪🇺" },
  IDR: { symbol: "Rp", label: "IDR", flag: "🇮🇩" },
};

const STORAGE_KEY_EXPENSES  = "bcn_expenses_v3";
const STORAGE_KEY_NOTES     = "bcn_notes_v3";

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Formats EUR amount. @param {number} amount @returns {string} */
const fmtEUR = (amount) =>
  `€${Number(amount).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Converts EUR to IDR string. @param {number} eur @returns {string} */
const fmtIDR = (eur) =>
  `Rp ${Math.round(eur * TRIP_CONFIG.exchangeRate.eurToIdr).toLocaleString("id-ID")}`;

/** Formats raw IDR amount. @param {number} idr @returns {string} */
const fmtIDRDirect = (idr) =>
  `Rp ${Math.round(idr).toLocaleString("id-ID")}`;

/**
 * Converts input currency to EUR.
 * @param {number} amount @param {"EUR"|"IDR"} currency @returns {number}
 */
const toEUR = (amount, currency) =>
  currency === "IDR" ? amount / TRIP_CONFIG.exchangeRate.eurToIdr : amount;

/** Returns today in Barcelona (YYYY-MM-DD). @returns {string} */
const barcelonaToday = () => {
  const bcn = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  return bcn.toISOString().split("T")[0];
};

/** Returns current hour in Barcelona. @returns {number} */
const barcelonaHour = () =>
  parseInt(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid", hour: "numeric", hour12: false }));

/** Returns current time HH:MM in Barcelona. @returns {string} */
const barcelonaTime = () =>
  new Date().toLocaleTimeString("id-ID", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });

/** Groups expenses by date. @param {Array} expenses @returns {Object} */
const groupByDate = (expenses) =>
  expenses.reduce((acc, e) => { (acc[e.date] = acc[e.date] || []).push(e); return acc; }, {});

/** Sums expense amounts. @param {Array} expenses @returns {number} */
const sumExpenses = (expenses) =>
  expenses.reduce((s, e) => s + Number(e.amount), 0);

/** Generates unique ID. @returns {string} */
const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** Returns formatted date label. @param {string} dateStr @returns {string} */
const dayLabel = (dateStr) =>
  new Date(dateStr + "T12:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" });

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * Loads data from localStorage.
 * @param {string} key @param {any} defaultValue @returns {any}
 */
const load = (key, defaultValue) => {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : defaultValue; }
  catch { return defaultValue; }
};

/**
 * Saves data to localStorage.
 * @param {string} key @param {any} data
 */
const save = (key, data) => {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {}
};

// ─── Components ───────────────────────────────────────────────────────────────

/** Budget progress bar. */
function BudgetBar({ spent, total }) {
  const pct = Math.min((spent / total) * 100, 100);
  const color = pct < 75 ? "#34d399" : pct < 90 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
        <span>Terpakai: {fmtEUR(spent)}</span>
        <span>Budget: {fmtEUR(total)}</span>
      </div>
      <div style={{ height: 8, background: "#1e3a5f", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,#34d399,${color})`, borderRadius: 10, transition: "width 1s ease" }} />
      </div>
      <div style={{ textAlign: "right", fontSize: 11, color, marginTop: 3 }}>
        {pct.toFixed(1)}% — Sisa {fmtEUR(total - spent)}
      </div>
    </div>
  );
}

/** Single expense row with delete. */
function ExpenseRow({ expense, onDelete }) {
  const cat = CATEGORIES[expense.category] ?? CATEGORIES.other;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: "#162032", borderLeft: `3px solid ${cat.color}`, marginBottom: 6 }}>
      <span style={{ fontSize: 18 }}>{cat.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {expense.description}
          {expense.outOfPocket && (
            <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "#78350f", color: "#fbbf24", fontWeight: 700 }}>OOP</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#64748b" }}>{cat.label} · {expense.time}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {expense.currency === "IDR" && expense.amountOrig ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: cat.color }}>{fmtIDRDirect(expense.amountOrig)}</div>
            <div style={{ fontSize: 10, color: "#475569" }}>{fmtEUR(expense.amount)}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: cat.color }}>{fmtEUR(expense.amount)}</div>
            <div style={{ fontSize: 10, color: "#475569" }}>{fmtIDR(expense.amount)}</div>
          </>
        )}
      </div>
      <button onClick={() => onDelete(expense.id)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 20, padding: "0 2px", lineHeight: 1 }}>×</button>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "9px 10px", borderRadius: 8, background: "#0f172a", border: "1px solid #2d3f60", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" };

/**
 * Manual expense entry form.
 * @param {Object} props
 * @param {Function} props.onAdd - Callback to add an expense
 */
function AddExpensePanel({ onAdd }) {
  const [form, setForm] = useState({ amount: "", currency: "EUR", category: "lunch", description: "", date: barcelonaToday(), outOfPocket: false });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const requiresSpecify = CATEGORIES[form.category]?.requiresSpecify;
  const isForeign = form.currency !== "IDR";

  const handleSubmit = () => {
    const raw = parseFloat(form.amount);
    if (!raw || isNaN(raw)) return;
    if (requiresSpecify && !form.description.trim()) return;
    onAdd({
      id: genId(),
      amount: toEUR(raw, form.currency),
      amountOrig: raw,
      currency: form.currency,
      category: form.category,
      description: form.description || CATEGORIES[form.category].label,
      date: form.date,
      time: barcelonaTime(),
      outOfPocket: form.outOfPocket,
    });
    setForm({ amount: "", currency: form.currency, category: form.category, description: "", date: barcelonaToday(), outOfPocket: false });
  };

  return (
    <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, padding: 18, marginBottom: 18 }}>
      {/* Amount + Currency */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Jumlah ({form.currency === "IDR" ? "Rp" : "€"})</div>
          <input type="number" step={form.currency === "IDR" ? "1000" : "0.01"} placeholder={form.currency === "IDR" ? "0" : "0.00"}
            value={form.amount} onChange={e => set("amount", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Mata Uang</div>
          <div style={{ display: "flex", gap: 4 }}>
            {Object.entries(CURRENCIES).map(([k, c]) => (
              <button key={k} onClick={() => set("currency", k)} style={{
                flex: 1, padding: "9px 4px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600,
                background: form.currency === k ? (k === "EUR" ? "#1d4ed8" : "#166534") : "#1e293b",
                color: form.currency === k ? "#fff" : "#64748b",
              }}>{c.flag} {c.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Currency conversion preview */}
      {form.amount && !isNaN(parseFloat(form.amount)) && (
        <div style={{ fontSize: 11, color: "#34d399", marginBottom: 8, textAlign: "right" }}>
          {form.currency === "IDR"
            ? `≈ ${fmtEUR(toEUR(parseFloat(form.amount), "IDR"))}`
            : `≈ ${fmtIDR(toEUR(parseFloat(form.amount), form.currency))} (IDR)`}
        </div>
      )}

      {/* Category */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Kategori</div>
        <select value={form.category} onChange={e => set("category", e.target.value)} style={inputStyle}>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
      </div>

      {/* Description + Date */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
            Deskripsi {requiresSpecify && <span style={{ color: "#f472b6" }}>*specify</span>}
          </div>
          <input
            placeholder={requiresSpecify ? "Wajib: jelaskan pengeluaran" : "Nama tempat / item"}
            value={form.description}
            onChange={e => set("description", e.target.value)}
            style={{ ...inputStyle, borderColor: requiresSpecify && !form.description.trim() ? "#f472b6" : "#2d3f60" }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Tanggal</div>
          <input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={inputStyle} />
        </div>
      </div>

      {/* Out of pocket toggle */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 10px", borderRadius: 8, background: "#0f172a", border: "1px solid #2d3f60", cursor: "pointer", fontSize: 12, color: "#cbd5e1" }}>
        <input
          type="checkbox"
          checked={form.outOfPocket}
          onChange={e => set("outOfPocket", e.target.checked)}
          style={{ accentColor: "#f59e0b", width: 16, height: 16, cursor: "pointer" }}
        />
        <span>💵 Out of pocket <span style={{ color: "#64748b" }}>(dibayar pribadi, perlu reimburse)</span></span>
      </label>

      <button
        onClick={handleSubmit}
        disabled={requiresSpecify && !form.description.trim()}
        style={{
          width: "100%", padding: 11, borderRadius: 9, border: "none",
          background: requiresSpecify && !form.description.trim() ? "#334155" : "linear-gradient(135deg,#2563eb,#7c3aed)",
          color: "#fff", fontWeight: 700, fontSize: 14,
          cursor: requiresSpecify && !form.description.trim() ? "not-allowed" : "pointer",
          opacity: requiresSpecify && !form.description.trim() ? 0.6 : 1,
        }}
      >
        + Tambah Pengeluaran
      </button>
    </div>
  );
}

/**
 * Daily summary card — shows expenses + manual notes.
 * Notes replace the AI summary feature.
 */
function DayCard({ date, expenses, note, onDelete, onSaveNote }) {
  const [expanded, setExpanded] = useState(true);
  const [editNote, setEditNote] = useState(false);
  const [noteText, setNoteText] = useState(note || "");
  const total = sumExpenses(expenses);

  const handleSaveNote = () => {
    onSaveNote(date, noteText);
    setEditNote(false);
  };

  return (
    <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, marginBottom: 14, overflow: "hidden" }}>
      {/* Header */}
      <div onClick={() => setExpanded(e => !e)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>{dayLabel(date)}</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>{expenses.length} transaksi</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: total > 35 ? "#f59e0b" : "#34d399" }}>{fmtEUR(total)}</div>
          <div style={{ fontSize: 11, color: "#475569" }}>{fmtIDR(total)}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 12px 14px" }}>
          {expenses.map(e => <ExpenseRow key={e.id} expense={e} onDelete={onDelete} />)}

          {/* Category pills */}
          <div style={{ display: "flex", gap: 4, margin: "8px 0", flexWrap: "wrap" }}>
            {Object.entries(CATEGORIES).map(([key, cat]) => {
              const t = sumExpenses(expenses.filter(e => e.category === key));
              if (!t) return null;
              return (
                <div key={key} style={{ background: `${cat.color}18`, border: `1px solid ${cat.color}40`, borderRadius: 20, padding: "3px 10px", fontSize: 11, color: cat.color }}>
                  {cat.icon} {fmtEUR(t)}
                </div>
              );
            })}
          </div>

          {/* Notes section (replaces AI summary) */}
          {editNote ? (
            <div style={{ marginTop: 8 }}>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Tulis catatan harian kamu di sini..."
                rows={4}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button onClick={handleSaveNote} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: "#166534", color: "#6ee7b7", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                  ✓ Simpan Catatan
                </button>
                <button onClick={() => { setEditNote(false); setNoteText(note || ""); }} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #334155", background: "none", color: "#64748b", fontSize: 12, cursor: "pointer" }}>
                  Batal
                </button>
              </div>
            </div>
          ) : note ? (
            <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 14px", marginTop: 8, borderLeft: "3px solid #38bdf8" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: "#38bdf8", fontWeight: 700 }}>🌙 Catatan Malam</div>
                <button onClick={() => setEditNote(true)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 11, cursor: "pointer" }}>Edit</button>
              </div>
              <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{note}</div>
            </div>
          ) : (
            <button onClick={() => setEditNote(true)} style={{ width: "100%", marginTop: 10, padding: 9, background: "#0c4a6e", border: "1px solid #0891b2", borderRadius: 8, color: "#7dd3fc", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
              🌙 Tulis Catatan Malam
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

/**
 * Barcelona Trip Expense Tracker.
 *
 * Features:
 * - Input manual EUR & IDR dengan konversi otomatis
 * - Budget tracking real-time
 * - Rekap per hari + catatan malam manual
 * - Persistent storage via localStorage
 * - Reminder notifikasi jam 9 malam Barcelona (browser notification)
 *
 * Requirements: React 18+, localStorage
 */
export default function App() {
  const [expenses,  setExpenses]  = useState(() => load(STORAGE_KEY_EXPENSES, []));
  const [notes,     setNotes]     = useState(() => load(STORAGE_KEY_NOTES, {}));
  const [activeTab, setActiveTab] = useState("add");
  const [saved,     setSaved]     = useState(false);
  const timerRef = useRef(null);

  // Persist on change
  useEffect(() => { save(STORAGE_KEY_EXPENSES, expenses); setSaved(true); setTimeout(() => setSaved(false), 1500); }, [expenses]);
  useEffect(() => { save(STORAGE_KEY_NOTES, notes); }, [notes]);

  // Reminder at 21:00 Barcelona — browser notification (no API needed)
  useEffect(() => {
    const check = () => {
      const h = barcelonaHour(), today = barcelonaToday();
      if (h === TRIP_CONFIG.summaryHour) {
        const todayExp = expenses.filter(e => e.date === today);
        if (todayExp.length > 0 && !notes[today]) {
          if (Notification.permission === "granted") {
            new Notification("🌙 Barcelona Tracker", {
              body: `Total hari ini: ${fmtEUR(sumExpenses(todayExp))}. Jangan lupa tulis catatan malam!`,
              icon: "https://cdn.jsdelivr.net/npm/twemoji@14/2/72x72/1f1ea-1f1f8.png",
            });
          }
        }
      }
    };
    timerRef.current = setInterval(check, 60_000);
    // Request notification permission on first load
    if (Notification.permission === "default") Notification.requestPermission();
    return () => clearInterval(timerRef.current);
  }, [expenses, notes]);

  const handleAdd    = useCallback(exp => setExpenses(p => [exp, ...p]), []);
  const handleDelete = useCallback(id  => setExpenses(p => p.filter(e => e.id !== id)), []);
  const handleSaveNote = useCallback((date, text) => setNotes(n => ({ ...n, [date]: text })), []);

  const totalVariable = sumExpenses(expenses);
  const totalSpent    = TRIP_CONFIG.spentFixed + totalVariable;
  const remaining     = TRIP_CONFIG.totalBudgetEUR - totalSpent;
  const byDate        = groupByDate(expenses);
  const sortedDates   = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const today         = barcelonaToday();

  return (
    <div style={{ minHeight: "100vh", background: "#0a1628", fontFamily: "'Segoe UI',system-ui,-apple-system,sans-serif", color: "#e2e8f0" }}>
      <style>{`* { box-sizing: border-box; } select option { background: #0f172a; } ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }`}</style>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1e3a5f,#1a1a3e)", padding: "18px 18px 14px", borderBottom: "1px solid #2d3f60", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#f8fafc" }}>🇪🇸 Barcelona Tracker</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>2–9 Juni 2026</div>
          </div>
          <div style={{ fontSize: 10, color: saved ? "#34d399" : "#475569", background: "#1e293b", padding: "3px 10px", borderRadius: 12 }}>
            {saved ? "✅ Tersimpan" : "💾 Local"}
          </div>
        </div>
        <BudgetBar spent={totalSpent} total={TRIP_CONFIG.totalBudgetEUR} />
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12 }}>
          <div><span style={{ color: "#64748b" }}>Variabel: </span><span style={{ color: "#38bdf8", fontWeight: 700 }}>{fmtEUR(totalVariable)}</span></div>
          <div><span style={{ color: "#64748b" }}>Sisa: </span><span style={{ color: remaining < 50 ? "#ef4444" : "#34d399", fontWeight: 700 }}>{fmtEUR(remaining)}</span></div>
          <div><span style={{ color: "#94a3b8" }}>{fmtIDR(remaining)}</span></div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b", background: "#0f172a", position: "sticky", top: 122, zIndex: 99 }}>
        {[["add","➕ Input"],["history","📅 Riwayat"],["budget","💰 Budget"]].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            flex: 1, padding: "12px 0", border: "none", background: "none",
            color: activeTab === id ? "#38bdf8" : "#64748b",
            fontWeight: activeTab === id ? 700 : 400, fontSize: 13, cursor: "pointer",
            borderBottom: activeTab === id ? "2px solid #38bdf8" : "2px solid transparent",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: "18px 16px", maxWidth: 600, margin: "0 auto" }}>

        {/* Tab: Input */}
        {activeTab === "add" && (
          <>
            <AddExpensePanel onAdd={handleAdd} />
            {(() => {
              const todayExp = expenses.filter(e => e.date === today);
              if (!todayExp.length) return <div style={{ textAlign: "center", color: "#475569", fontSize: 13, padding: "20px 0" }}>Belum ada pengeluaran hari ini</div>;
              return (
                <>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, fontWeight: 600 }}>HARI INI · {fmtEUR(sumExpenses(todayExp))}</div>
                  {todayExp.map(e => <ExpenseRow key={e.id} expense={e} onDelete={handleDelete} />)}
                </>
              );
            })()}
          </>
        )}

        {/* Tab: History */}
        {activeTab === "history" && (
          sortedDates.length === 0
            ? <div style={{ textAlign: "center", color: "#475569", fontSize: 13, padding: "40px 0" }}>Belum ada data pengeluaran</div>
            : sortedDates.map(date => (
                <DayCard key={date} date={date} expenses={byDate[date]}
                  note={notes[date] ?? null}
                  onDelete={handleDelete}
                  onSaveNote={handleSaveNote} />
              ))
        )}

        {/* Tab: Budget */}
        {activeTab === "budget" && (
          <>
            <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>Ringkasan Budget</div>
              {[
                { label: "Total Budget",         value: TRIP_CONFIG.totalBudgetEUR, color: "#38bdf8" },
                { label: "Biaya Tetap",           value: TRIP_CONFIG.spentFixed,    color: "#f59e0b", sub: "transport JKT + WiFi + sebelumnya" },
                { label: "Pengeluaran Variabel",  value: totalVariable,             color: "#a78bfa", sub: `${expenses.length} transaksi` },
                { label: "Total Terpakai",        value: totalSpent,                color: "#ef4444" },
                { label: "Sisa Budget",           value: remaining,                 color: remaining < 50 ? "#ef4444" : "#34d399" },
              ].map(({ label, value, color, sub }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1e293b" }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#e2e8f0" }}>{label}</div>
                    {sub && <div style={{ fontSize: 11, color: "#64748b" }}>{sub}</div>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color }}>{fmtEUR(value)}</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>{fmtIDR(value)}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Category breakdown */}
            <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>Per Kategori</div>
              {Object.entries(CATEGORIES).map(([key, cat]) => {
                const t = sumExpenses(expenses.filter(e => e.category === key));
                if (!t) return null;
                const pct = totalVariable > 0 ? (t / totalVariable) * 100 : 0;
                return (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: "#e2e8f0" }}>{cat.icon} {cat.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: cat.color }}>{fmtEUR(t)}</span>
                    </div>
                    <div style={{ height: 4, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: cat.color, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
              {totalVariable === 0 && <div style={{ textAlign: "center", color: "#475569", fontSize: 13, padding: "20px 0" }}>Belum ada pengeluaran variabel</div>}
            </div>

            {/* Daily avg */}
            {totalVariable > 0 && (() => {
              const days = [...new Set(expenses.map(e => e.date))].length || 1;
              const avg = totalVariable / days;
              return (
                <div style={{ background: "#1a2744", border: `1px solid ${avg > 35 ? "#f59e0b" : "#22c55e"}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Rata-rata Harian</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: avg > 35 ? "#f59e0b" : "#34d399" }}>{fmtEUR(avg)}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>per hari · {days} hari tercatat</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>Target</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#38bdf8" }}>€35,00</div>
                      <div style={{ fontSize: 11, color: avg > 35 ? "#f59e0b" : "#34d399" }}>
                        {avg > 35 ? `↑ ${fmtEUR(avg - 35)} over` : `↓ ${fmtEUR(35 - avg)} under`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
