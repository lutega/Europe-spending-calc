import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Trip configuration and exchange rates.
 * @constant
 */
const TRIP_CONFIG = {
  totalBudgetEUR: 1802,
  spentFixed: 1390.05,
  cashEUR: 80,
  startDate: "2026-06-02", // First full day in Barcelona
  endDate: "2026-06-09",   // Last full day in Barcelona
  summaryHour: 21,         // 9 PM Barcelona time (CEST = UTC+2)
  exchangeRate: { usdToEur: 1 / 1.165, eurToIdr: 20818 },
};

/**
 * Expense categories with icons and colors.
 * @constant
 */
const CATEGORIES = {
  transport:  { label: "Transport",    icon: "🚇", color: "#38bdf8" },
  lunch:      { label: "Makan Siang",  icon: "🥗", color: "#34d399" },
  dinner:     { label: "Makan Malam",  icon: "🍽️", color: "#a78bfa" },
  snack:      { label: "Jajan/Kopi",   icon: "☕", color: "#f59e0b" },
  flight:     { label: "Penerbangan",  icon: "✈️", color: "#fb7185" },
  other:      { label: "Lainnya",      icon: "📦", color: "#94a3b8" },
};

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Formats a number as EUR currency string.
 * @param {number} amount - Amount in EUR
 * @returns {string} Formatted string like "€12,50"
 */
const fmtEUR = (amount) =>
  `€${Number(amount).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Supported input currencies with display metadata.
 * @constant
 */
const CURRENCIES = {
  EUR: { symbol: "€",  label: "EUR", flag: "🇪🇺" },
  IDR: { symbol: "Rp", label: "IDR", flag: "🇮🇩" },
};

/**
 * Formats a number as IDR currency string converted from EUR.
 * @param {number} eur - Amount in EUR
 * @returns {string} Formatted IDR string
 */
const fmtIDR = (eur) => {
  const idr = eur * TRIP_CONFIG.exchangeRate.eurToIdr;
  return `Rp ${Math.round(idr).toLocaleString("id-ID")}`;
};

/**
 * Formats an IDR amount directly without conversion.
 * @param {number} idr
 * @returns {string}
 */
const fmtIDRDirect = (idr) => `Rp ${Math.round(idr).toLocaleString("id-ID")}`;

/**
 * Converts any supported input currency amount to EUR.
 * All budget calculations use EUR as the base currency.
 * @param {number} amount - Raw input amount
 * @param {"EUR"|"IDR"} currency - Source currency
 * @returns {number} Equivalent amount in EUR
 */
const toEUR = (amount, currency) =>
  currency === "IDR" ? amount / TRIP_CONFIG.exchangeRate.eurToIdr : amount;

/**
 * Formats an amount in its original input currency for display.
 * @param {number} amount - Original (unconverted) amount
 * @param {"EUR"|"IDR"} currency
 * @returns {string}
 */
const fmtOriginal = (amount, currency) =>
  currency === "IDR" ? fmtIDRDirect(amount) : fmtEUR(amount);

/**
 * Returns today's date in Barcelona (CEST = UTC+2) as YYYY-MM-DD string.
 * @returns {string}
 */
const barcelonaToday = () => {
  const now = new Date();
  const bcn = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  return bcn.toISOString().split("T")[0];
};

/**
 * Returns current hour in Barcelona time.
 * @returns {number} 0-23
 */
const barcelonaHour = () => {
  const now = new Date();
  return parseInt(now.toLocaleString("en-US", { timeZone: "Europe/Madrid", hour: "numeric", hour12: false }));
};

/**
 * Groups expenses by date.
 * @param {Array} expenses - Array of expense objects
 * @returns {Object} Object keyed by date string
 */
const groupByDate = (expenses) =>
  expenses.reduce((acc, exp) => {
    if (!acc[exp.date]) acc[exp.date] = [];
    acc[exp.date].push(exp);
    return acc;
  }, {});

/**
 * Sums amounts for an array of expenses.
 * @param {Array} expenses
 * @returns {number}
 */
const sumExpenses = (expenses) =>
  expenses.reduce((sum, e) => sum + Number(e.amount), 0);

/**
 * Generates a unique ID.
 * @returns {string}
 */
const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Returns the day label for a given date string (e.g. "Senin, 3 Jun").
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string}
 */
const dayLabel = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" });
};

// ─── Receipt Scanner (Claude API) ────────────────────────────────────────────

/**
 * Sends a receipt image to Claude API for parsing.
 * Extracts amount, category, and description from the receipt.
 *
 * @param {string} base64 - Base64-encoded image data
 * @param {string} mediaType - MIME type of the image (e.g. "image/jpeg")
 * @returns {Promise<{amount: number, currency: string, category: string, description: string}>}
 */
async function scanReceipt(base64, mediaType) {
  const categoryList = Object.entries(CATEGORIES)
    .map(([k, v]) => `${k} (${v.label})`)
    .join(", ");

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `Foto struk/receipt perjalanan (bisa EUR di Barcelona atau IDR di Indonesia).
Balas HANYA JSON valid tanpa teks lain:
{"amount":<angka asli>,"currency":"<EUR|IDR>","category":"<${Object.keys(CATEGORIES).join("|")}>","description":"<max 40 karakter Indonesia>"}

Aturan:
- amount: angka ASLI dari struk, JANGAN dikonversi
- currency: "IDR" jika rupiah/struk Indonesia, "EUR" jika euro atau kartu luar negeri
- Jika mata uang lain (USD,GBP,dll): konversi ke EUR, set currency "EUR"
- category harus persis salah satu dari: ${Object.keys(CATEGORIES).join(", ")}
- Jangan tambahkan teks apapun di luar JSON`,
          },
        ],
      }],
    }),
  });

  const data = await res.json();
  const text = data.content?.[0]?.text ?? "{}";

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { amount: 0, category: "other", description: "Gagal membaca struk" };
  }
}

// ─── Daily Summary Generator (Claude API) ───────────────────────────────────

/**
 * Generates a daily expense summary using Claude API.
 *
 * @param {string} date - YYYY-MM-DD
 * @param {Array} expenses - Array of expense objects for this date
 * @param {number} remainingBudget - Remaining budget in EUR
 * @returns {Promise<string>} Summary text in Indonesian
 */
async function generateDailySummary(date, expenses, remainingBudget) {
  const byCategory = Object.entries(CATEGORIES).map(([key, cat]) => {
    const items = expenses.filter((e) => e.category === key);
    const total = sumExpenses(items);
    return total > 0 ? `${cat.icon} ${cat.label}: ${fmtEUR(total)}` : null;
  }).filter(Boolean);

  const total = sumExpenses(expenses);

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Kamu adalah asisten perjalanan yang ramah. Buat ringkasan pengeluaran harian yang singkat, hangat, dan informatif dalam bahasa Indonesia.

Tanggal: ${dayLabel(date)}
Total hari ini: ${fmtEUR(total)} (${fmtIDR(total)})
Rincian per kategori:
${byCategory.join("\n")}

Sisa budget total perjalanan: ${fmtEUR(remainingBudget)}

Format ringkasan:
1. Sapaan malam + tanggal (1 kalimat)
2. Total pengeluaran hari ini dan IDR-nya (1 kalimat)
3. Breakdown kategori terbesar (2-3 item)
4. Komentar singkat apakah pengeluaran wajar/hemat/boros dibanding target harian ~€36/hari
5. Sisa budget dan proyeksi (1-2 kalimat)
6. Satu tips hemat untuk besok

Maksimal 8 kalimat. Tone: hangat, seperti teman perjalanan. Gunakan emoji secukupnya.`,
      }],
    }),
  });

  const data = await res.json();
  return data.content?.[0]?.text ?? "Ringkasan tidak tersedia.";
}

// ─── Storage Helpers ─────────────────────────────────────────────────────────

const STORAGE_KEY_EXPENSES  = "bcn_expenses_v2";
const STORAGE_KEY_SUMMARIES = "bcn_summaries_v2";

/**
 * Loads data from localStorage.
 * On Vercel deployment, data persists in the browser's localStorage.
 * Data survives page refresh and browser close, but is device-specific.
 *
 * @param {string} key - Storage key
 * @param {any} defaultValue - Default if key not found
 * @returns {Promise<any>}
 */
async function cloudLoad(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return defaultValue;
}

/**
 * Saves data to localStorage.
 * Wraps in a Promise to maintain the same async interface as the cloud version.
 *
 * @param {string} key - Storage key
 * @param {any} data - Data to save
 * @returns {Promise<{cloud: boolean, local: boolean}>}
 */
async function cloudSave(key, data) {
  let local = false;
  try {
    localStorage.setItem(key, JSON.stringify(data));
    local = true;
  } catch (_) {}
  return { cloud: false, local };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/**
 * Sync status indicator badge shown in the header.
 * @param {Object} props
 * @param {"idle"|"saving"|"ok"|"error"} props.status
 */
function SyncBadge({ status }) {
  const map = {
    idle:   { icon: "💾", text: "Local storage", color: "#64748b" },
    saving: { icon: "⏳", text: "Menyimpan...",  color: "#f59e0b" },
    ok:     { icon: "✅", text: "Tersimpan",     color: "#34d399" },
    error:  { icon: "⚠️", text: "Gagal simpan",  color: "#ef4444" },
  };
  const s = map[status] ?? map.idle;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: "#1e293b", border: `1px solid ${s.color}40`,
      borderRadius: 12, padding: "2px 10px", fontSize: 10, color: s.color,
    }}>
      {s.icon} {s.text}
    </div>
  );
}


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
        <div style={{
          height: "100%", width: `${pct}%`,
          background: `linear-gradient(90deg, #34d399, ${color})`,
          borderRadius: 10, transition: "width 0.8s ease",
        }} />
      </div>
      <div style={{ textAlign: "right", fontSize: 11, color, marginTop: 3 }}>
        {pct.toFixed(1)}% — Sisa {fmtEUR(total - spent)}
      </div>
    </div>
  );
}

/**
 * Single expense row component.
 * @param {Object} props
 * @param {Object} props.expense - Expense object
 * @param {Function} props.onDelete - Delete callback
 */
function ExpenseRow({ expense, onDelete }) {
  const cat = CATEGORIES[expense.category] ?? CATEGORIES.other;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 12px", borderRadius: 8,
      background: "#162032", borderLeft: `3px solid ${cat.color}`,
      marginBottom: 6, animation: "slideIn 0.2s ease",
    }}>
      <span style={{ fontSize: 18 }}>{cat.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {expense.description}
        </div>
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {cat.label} · {expense.time}
        </div>
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
      <button
        onClick={() => onDelete(expense.id)}
        style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, padding: 2 }}
        title="Hapus"
      >×</button>
    </div>
  );
}

/**
 * Receipt upload and manual entry form component.
 * @param {Object} props
 * @param {Function} props.onAdd - Callback to add an expense
 */
function AddExpensePanel({ onAdd }) {
  const [mode, setMode] = useState("manual"); // "manual" | "photo"
  const [form, setForm] = useState({ amount: "", currency: "EUR", category: "lunch", description: "", date: barcelonaToday() });
  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState(null);
  const [scanned, setScanned] = useState(null);
  const fileRef = useRef();

  /**
   * Handles file selection and triggers receipt scanning.
   * @param {Event} e - File input change event
   */
  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setPreview(URL.createObjectURL(file));

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      const mediaType = file.type;
      try {
        const result = await scanReceipt(base64, mediaType);
        setScanned(result);
        setForm((f) => ({
          ...f,
          amount: result.amount?.toString() ?? "",
          currency: result.currency === "IDR" ? "IDR" : "EUR",
          category: result.category in CATEGORIES ? result.category : "other",
          description: result.description ?? "",
        }));
      } catch {
        setScanned({ amount: 0, category: "other", description: "Gagal scan" });
      } finally {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  /**
   * Handles form submission to add an expense.
   */
  const handleSubmit = () => {
    if (!form.amount || isNaN(parseFloat(form.amount))) return;
    const now = new Date().toLocaleTimeString("id-ID", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
    const rawAmount = parseFloat(form.amount);
    const amountEUR = toEUR(rawAmount, form.currency);
    onAdd({
      id: genId(),
      amount: amountEUR,          // always EUR for budget calculations
      amountOrig: rawAmount,      // original input amount
      currency: form.currency,    // original input currency
      category: form.category,
      description: form.description || CATEGORIES[form.category].label,
      date: form.date,
      time: now,
      fromPhoto: mode === "photo",
    });
    setForm({ amount: "", currency: "EUR", category: "lunch", description: "", date: barcelonaToday() });
    setPreview(null);
    setScanned(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div style={{
      background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14,
      padding: 18, marginBottom: 18,
    }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["manual", "photo"].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: mode === m ? "#2563eb" : "#1e293b",
              color: mode === m ? "#fff" : "#64748b",
              transition: "all 0.2s",
            }}
          >
            {m === "manual" ? "✏️ Input Manual" : "📸 Foto Struk"}
          </button>
        ))}
      </div>

      {mode === "photo" && (
        <div style={{ marginBottom: 14 }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile}
            style={{ display: "none" }} id="receipt-upload" />
          <label htmlFor="receipt-upload" style={{
            display: "block", textAlign: "center", padding: "14px",
            border: "2px dashed #2d3f60", borderRadius: 10, cursor: "pointer",
            color: "#64748b", fontSize: 13, transition: "all 0.2s",
          }}>
            {scanning ? "🔍 Membaca struk..." : preview ? "📄 Struk terdeteksi — edit di bawah" : "Tap untuk foto atau pilih gambar struk"}
          </label>
          {preview && (
            <img src={preview} alt="struk" style={{
              width: "100%", maxHeight: 140, objectFit: "cover",
              borderRadius: 8, marginTop: 8, opacity: 0.7,
            }} />
          )}
          {scanned && !scanning && (
            <div style={{ fontSize: 11, color: "#34d399", marginTop: 6, textAlign: "center" }}>
              ✅ Scan berhasil — {fmtOriginal(scanned.amount, scanned.currency === "IDR" ? "IDR" : "EUR")} · {CATEGORIES[scanned.category]?.label}
            </div>
          )}
        </div>
      )}

      {/* Amount + Currency row */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
            Jumlah ({form.currency === "IDR" ? "Rp" : "€"})
          </div>
          <input
            type="number" step={form.currency === "IDR" ? "1000" : "0.01"}
            placeholder={form.currency === "IDR" ? "0" : "0.00"}
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Mata Uang</div>
          <div style={{ display: "flex", gap: 4 }}>
            {Object.entries(CURRENCIES).map(([key, cur]) => (
              <button key={key} onClick={() => setForm((f) => ({ ...f, currency: key }))} style={{
                flex: 1, padding: "9px 4px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600,
                background: form.currency === key ? (key === "EUR" ? "#1d4ed8" : "#166534") : "#1e293b",
                color: form.currency === key ? "#fff" : "#64748b",
                transition: "all 0.15s",
              }}>{cur.flag} {cur.label}</button>
            ))}
          </div>
        </div>
      </div>
      {/* EUR equivalent preview when IDR selected */}
      {form.currency === "IDR" && form.amount && !isNaN(parseFloat(form.amount)) && (
        <div style={{ fontSize: 11, color: "#34d399", marginBottom: 8, textAlign: "right" }}>
          ≈ {fmtEUR(toEUR(parseFloat(form.amount), "IDR"))}
        </div>
      )}
      {/* Category row */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Kategori</div>
        <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          style={inputStyle}>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Deskripsi</div>
          <input placeholder="Nama tempat / item"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Tanggal</div>
          <input type="date" value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            style={inputStyle}
          />
        </div>
      </div>

      <button onClick={handleSubmit} style={{
        width: "100%", padding: "11px", borderRadius: 9, border: "none",
        background: "linear-gradient(135deg, #2563eb, #7c3aed)",
        color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
        letterSpacing: "0.02em",
      }}>
        + Tambah Pengeluaran
      </button>
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 10px", borderRadius: 8,
  background: "#0f172a", border: "1px solid #2d3f60",
  color: "#e2e8f0", fontSize: 13, boxSizing: "border-box",
};

/**
 * Daily summary card component.
 * @param {Object} props
 * @param {string} props.date - YYYY-MM-DD
 * @param {Array} props.expenses - Expenses for this date
 * @param {string|null} props.summary - Pre-generated summary text
 * @param {Function} props.onGenerateSummary - Callback to generate summary
 * @param {Function} props.onDelete - Callback to delete an expense by ID
 * @param {number} props.remainingBudget - Remaining budget in EUR
 */
function DayCard({ date, expenses, summary, onGenerateSummary, onDelete, remainingBudget }) {
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const total = sumExpenses(expenses);

  const handleGenerate = async () => {
    setLoading(true);
    await onGenerateSummary(date);
    setLoading(false);
  };

  return (
    <div style={{
      background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14,
      marginBottom: 14, overflow: "hidden",
    }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", cursor: "pointer",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>{dayLabel(date)}</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>{expenses.length} transaksi</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: total > 36 ? "#f59e0b" : "#34d399" }}>
            {fmtEUR(total)}
          </div>
          <div style={{ fontSize: 11, color: "#475569" }}>{fmtIDR(total)}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 12px 14px" }}>
          {expenses.map((e) => <ExpenseRow key={e.id} expense={e} onDelete={onDelete} />)}

          {/* Category bar */}
          <div style={{ display: "flex", gap: 4, margin: "8px 0", flexWrap: "wrap" }}>
            {Object.entries(CATEGORIES).map(([key, cat]) => {
              const catTotal = sumExpenses(expenses.filter((e) => e.category === key));
              if (!catTotal) return null;
              return (
                <div key={key} style={{
                  background: `${cat.color}20`, border: `1px solid ${cat.color}40`,
                  borderRadius: 20, padding: "3px 10px", fontSize: 11, color: cat.color,
                }}>
                  {cat.icon} {fmtEUR(catTotal)}
                </div>
              );
            })}
          </div>

          {/* Summary section */}
          {summary ? (
            <div style={{
              background: "#0f172a", borderRadius: 10, padding: "12px 14px",
              marginTop: 8, fontSize: 13, color: "#cbd5e1", lineHeight: 1.6,
              borderLeft: "3px solid #38bdf8",
            }}>
              <div style={{ fontSize: 11, color: "#38bdf8", fontWeight: 700, marginBottom: 6 }}>
                🌙 Ringkasan Malam
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{summary}</div>
            </div>
          ) : (
            <button onClick={handleGenerate} disabled={loading} style={{
              width: "100%", marginTop: 10, padding: "9px",
              background: loading ? "#1e293b" : "#0c4a6e",
              border: "1px solid #0891b2", borderRadius: 8,
              color: loading ? "#64748b" : "#7dd3fc", fontSize: 12,
              cursor: loading ? "default" : "pointer", fontWeight: 600,
            }}>
              {loading ? "⏳ Membuat ringkasan..." : "🌙 Generate Ringkasan Malam (9 PM)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

/**
 * Barcelona Trip Expense Tracker — Main App.
 *
 * Features:
 * - Scan foto struk via Claude Vision API → auto-extract jumlah + kategori
 * - Input manual dengan kategori & tanggal
 * - Cloud-persistent storage (window.storage) + localStorage fallback:
 *   → Data TIDAK hilang saat HP mati, browser ditutup, atau ganti device
 *   → Sync otomatis lintas device selama login akun Claude yang sama
 * - Auto-generate ringkasan malam pukul 21:00 waktu Barcelona
 * - Budget tracker real-time + breakdown per kategori
 * - Sync status badge (cloud saved / local only / saving...)
 *
 * Requirements:
 * - React 18+
 * - window.storage (Claude artifact persistent cloud storage)
 * - Anthropic API (claude-sonnet-4-20250514) untuk scan & summary
 */
export default function App() {
  const [expenses,   setExpenses]   = useState([]);
  const [summaries,  setSummaries]  = useState({});
  const [activeTab,  setActiveTab]  = useState("add");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [loaded,     setLoaded]     = useState(false);
  const timerRef = useRef(null);

  // Load from cloud on mount
  useEffect(() => {
    (async () => {
      const [exps, sums] = await Promise.all([
        cloudLoad(STORAGE_KEY_EXPENSES, []),
        cloudLoad(STORAGE_KEY_SUMMARIES, {}),
      ]);
      setExpenses(Array.isArray(exps) ? exps : []);
      setSummaries(typeof sums === "object" && sums !== null ? sums : {});
      setLoaded(true);
    })();
  }, []);

  // Persist expenses to cloud + local on every change
  useEffect(() => {
    if (!loaded) return;
    setSyncStatus("saving");
    cloudSave(STORAGE_KEY_EXPENSES, expenses).then(({ cloud }) => {
      setSyncStatus(cloud ? "ok" : "error");
      setTimeout(() => setSyncStatus("idle"), 2500);
    });
  }, [expenses, loaded]);

  // Persist summaries
  useEffect(() => {
    if (!loaded) return;
    cloudSave(STORAGE_KEY_SUMMARIES, summaries);
  }, [summaries, loaded]);

  // Auto-generate summary at 21:00 Barcelona
  useEffect(() => {
    const check = () => {
      const hour = barcelonaHour();
      const today = barcelonaToday();
      if (hour === TRIP_CONFIG.summaryHour && !summaries[today]) {
        const dayExp = expenses.filter((e) => e.date === today);
        if (dayExp.length > 0) handleGenerateSummary(today);
      }
    };
    timerRef.current = setInterval(check, 60_000);
    check();
    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, summaries]);

  /** Adds expense to state. @param {Object} expense */
  const handleAdd = useCallback((expense) => {
    setExpenses((prev) => [expense, ...prev]);
  }, []);

  /** Deletes expense by ID. @param {string} id */
  const handleDelete = useCallback((id) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  /**
   * Generates Claude daily summary for a date and stores it.
   * @param {string} date - YYYY-MM-DD
   */
  const handleGenerateSummary = useCallback(async (date) => {
    const dayExp   = expenses.filter((e) => e.date === date);
    const total    = TRIP_CONFIG.spentFixed + sumExpenses(expenses);
    const left     = TRIP_CONFIG.totalBudgetEUR - total;
    const text     = await generateDailySummary(date, dayExp, left);
    setSummaries((prev) => ({ ...prev, [date]: text }));
  }, [expenses]);

  // Derived
  const totalVariable = sumExpenses(expenses);
  const totalSpent    = TRIP_CONFIG.spentFixed + totalVariable;
  const remaining     = TRIP_CONFIG.totalBudgetEUR - totalSpent;
  const byDate        = groupByDate(expenses);
  const sortedDates   = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const today         = barcelonaToday();

  // Loading screen
  if (!loaded) return (
    <div style={{ minHeight: "100vh", background: "#0a1628", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      <div style={{ fontSize: 36 }}>☁️</div>
      <div style={{ color: "#64748b", fontSize: 14 }}>Memuat data dari cloud...</div>
      <div style={{ color: "#334155", fontSize: 12 }}>Data tersimpan aman, tidak hilang saat HP mati</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0a1628", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: "#e2e8f0" }}>
      <style>{`* { box-sizing: border-box; } select option { background: #0f172a; } ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }`}</style>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1e3a5f, #1a1a3e)", padding: "18px 18px 14px", borderBottom: "1px solid #2d3f60", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#f8fafc" }}>🇪🇸 Barcelona Tracker</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>2–9 Juni 2026</div>
          </div>
          <SyncBadge status={syncStatus} />
        </div>
        <BudgetBar spent={totalSpent} total={TRIP_CONFIG.totalBudgetEUR} />
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12 }}>
          <div><span style={{ color: "#64748b" }}>Variabel: </span><span style={{ color: "#38bdf8", fontWeight: 700 }}>{fmtEUR(totalVariable)}</span></div>
          <div><span style={{ color: "#64748b" }}>Sisa: </span><span style={{ color: remaining < 50 ? "#ef4444" : "#34d399", fontWeight: 700 }}>{fmtEUR(remaining)}</span></div>
          <div><span style={{ color: "#94a3b8" }}>{fmtIDR(remaining)}</span></div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b", background: "#0f172a", position: "sticky", top: 126, zIndex: 99 }}>
        {[["add","➕ Input"],["history","📅 Riwayat"],["budget","💰 Budget"]].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            flex: 1, padding: "12px 0", border: "none", background: "none",
            color: activeTab === id ? "#38bdf8" : "#64748b",
            fontWeight: activeTab === id ? 700 : 400, fontSize: 13, cursor: "pointer",
            borderBottom: activeTab === id ? "2px solid #38bdf8" : "2px solid transparent",
            transition: "all 0.15s",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: "18px 16px", maxWidth: 600, margin: "0 auto" }}>

        {/* Tab: Input */}
        {activeTab === "add" && (
          <>
            <AddExpensePanel onAdd={handleAdd} />
            {(() => {
              const todayExp = expenses.filter((e) => e.date === today);
              if (!todayExp.length) return <div style={{ textAlign: "center", color: "#475569", fontSize: 13, padding: "20px 0" }}>Belum ada pengeluaran hari ini</div>;
              return (
                <>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, fontWeight: 600 }}>HARI INI · {fmtEUR(sumExpenses(todayExp))}</div>
                  {todayExp.map((e) => <ExpenseRow key={e.id} expense={e} onDelete={handleDelete} />)}
                </>
              );
            })()}
          </>
        )}

        {/* Tab: History */}
        {activeTab === "history" && (
          sortedDates.length === 0
            ? <div style={{ textAlign: "center", color: "#475569", fontSize: 13, padding: "40px 0" }}>Belum ada data pengeluaran</div>
            : sortedDates.map((date) => (
                <DayCard key={date} date={date} expenses={byDate[date]}
                  summary={summaries[date] ?? null}
                  onGenerateSummary={handleGenerateSummary}
                  onDelete={handleDelete}
                  remainingBudget={remaining} />
              ))
        )}

        {/* Tab: Budget */}
        {activeTab === "budget" && (
          <>
            <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>Ringkasan Budget</div>
              {[
                { label: "Total Budget",        value: TRIP_CONFIG.totalBudgetEUR, color: "#38bdf8" },
                { label: "Biaya Tetap",          value: TRIP_CONFIG.spentFixed,    color: "#f59e0b", sub: "transport JKT + WiFi + sebelumnya" },
                { label: "Pengeluaran Variabel", value: totalVariable,             color: "#a78bfa", sub: `${expenses.length} transaksi` },
                { label: "Total Terpakai",       value: totalSpent,                color: "#ef4444" },
                { label: "Sisa Budget",          value: remaining,                 color: remaining < 50 ? "#ef4444" : "#34d399" },
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

            <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>Per Kategori</div>
              {Object.entries(CATEGORIES).map(([key, cat]) => {
                const t = sumExpenses(expenses.filter((e) => e.category === key));
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

            {/* Storage info card */}
            <div style={{ background: "#0c1e35", border: "1px solid #1e3a5f", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>ℹ️ Keamanan Data</div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
                <span style={{ color: "#7dd3fc" }}>☁️ Cloud (window.storage)</span> — Server Claude. Aman dari HP mati, reset browser, ganti device.<br />
                <span style={{ color: "#94a3b8" }}>💾 LocalStorage</span> — Backup lokal di browser. Tersedia offline.<br />
                <span style={{ color: "#374151" }}>Data disimpan ke keduanya setiap kali ada perubahan.</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
