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

/** Reimbursement category buckets for corporate reporting. @constant */
const REIMBURSEMENT_CATEGORIES = {
  lodging: {
    label: "Lodging", icon: "🏨", color: "#60a5fa",
    definition: "Biaya akomodasi/penginapan selama dinas (hotel, hostel, Airbnb, guest house).",
  },
  boarding: {
    label: "Boarding", icon: "🍴", color: "#facc15",
    definition: "Biaya konsumsi makan & minum selama dinas (sarapan, makan siang, makan malam, snack, kopi).",
  },
  telephone: {
    label: "Telephone", icon: "📞", color: "#22d3ee",
    definition: "Biaya komunikasi (pulsa, paket data, roaming internasional, WiFi/internet pendukung kerja).",
  },
  taxi: {
    label: "Taxi", icon: "🚕", color: "#fbbf24",
    definition: "Biaya taksi & ride-hailing (Grab/Gojek/Uber/Bolt/Cabify), termasuk taksi bandara.",
  },
  conveyance: {
    label: "Conveyance", icon: "🚙", color: "#c084fc",
    definition: "Transportasi umum & antar-kota (pesawat, kereta, bus, metro/MRT, tram, kapal, rental kendaraan).",
  },
  others: {
    label: "Others", icon: "📝", color: "#f472b6",
    definition: "Pengeluaran lain di luar kategori di atas — wajib disertai keterangan (specify).",
  },
};

/** Maps primary category → reimbursement bucket. @constant */
const CATEGORY_TO_REIMBURSEMENT = {
  transport:  "conveyance",
  lunch:      "boarding",
  dinner:     "boarding",
  snack:      "boarding",
  flight:     "conveyance",
  lodging:    "lodging",
  boarding:   "boarding",
  telephone:  "telephone",
  taxi:       "taxi",
  conveyance: "conveyance",
  others:     "others",
  other:      "others",
};

/** Resolves an expense's reimbursement bucket (override → mapping → others). */
const reimbursementOf = (expense) =>
  expense.reimbursement || CATEGORY_TO_REIMBURSEMENT[expense.category] || "others";

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

/** Escapes HTML for safe injection into print window. */
const escapeHtml = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Builds & opens a print-ready window of the expense history table.
 * User can choose "Save as PDF" in the browser print dialog.
 */
const exportHistoryToPDF = (expenses, notes) => {
  const sorted = [...expenses].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const byDate = groupByDate(sorted);
  const dates = Object.keys(byDate).sort();

  const reimbTotals = Object.keys(REIMBURSEMENT_CATEGORIES).map((key) => {
    const items = expenses.filter((e) => reimbursementOf(e) === key);
    return { key, label: REIMBURSEMENT_CATEGORIES[key].label, count: items.length, total: sumExpenses(items) };
  }).filter((r) => r.total > 0);

  const oop = expenses.filter((e) => e.outOfPocket);
  const oopTotal = sumExpenses(oop);
  const grandTotal = sumExpenses(expenses);

  const dayBlocks = dates.map((date) => {
    const dayItems = byDate[date];
    const dayTotal = sumExpenses(dayItems);
    const rows = dayItems.map((e) => {
      const cat = CATEGORIES[e.category] ?? CATEGORIES.other;
      const reimb = REIMBURSEMENT_CATEGORIES[reimbursementOf(e)];
      const orig = e.currency === "IDR" && e.amountOrig
        ? fmtIDRDirect(e.amountOrig)
        : `${CURRENCIES[e.currency]?.symbol ?? ""}${Number(e.amountOrig ?? e.amount).toFixed(2)}`;
      return `<tr>
        <td>${escapeHtml(e.time)}</td>
        <td>${escapeHtml(e.description)}</td>
        <td>${escapeHtml(cat.label)}</td>
        <td>${escapeHtml(reimb?.label ?? "-")}</td>
        <td class="num">${escapeHtml(orig)}</td>
        <td class="num">${fmtEUR(e.amount)}</td>
        <td class="num">${fmtIDR(e.amount)}</td>
        <td class="center">${e.outOfPocket ? "✓" : ""}</td>
      </tr>`;
    }).join("");
    const note = notes?.[date];
    return `
      <h3>${escapeHtml(dayLabel(date))} <span class="muted">(${dayItems.length} tx · ${fmtEUR(dayTotal)})</span></h3>
      <table>
        <thead><tr>
          <th>Waktu</th><th>Deskripsi</th><th>Kategori</th><th>Reimbursement</th>
          <th class="num">Original</th><th class="num">EUR</th><th class="num">IDR</th><th class="center">OOP</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${note ? `<div class="note"><strong>Catatan:</strong> ${escapeHtml(note)}</div>` : ""}
    `;
  }).join("");

  const reimbRows = reimbTotals.map((r) =>
    `<tr><td>${escapeHtml(r.label)}</td><td class="center">${r.count}</td><td class="num">${fmtEUR(r.total)}</td><td class="num">${fmtIDR(r.total)}</td></tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Riwayat Pengeluaran — Barcelona</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Segoe UI, system-ui, sans-serif; color: #111; padding: 24px; font-size: 11px; line-height: 1.4; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      h2 { font-size: 14px; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #333; }
      h3 { font-size: 12px; margin: 14px 0 6px; color: #1e3a5f; }
      .muted { color: #666; font-weight: normal; font-size: 10px; }
      .meta { color: #666; font-size: 10px; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      th, td { padding: 5px 7px; border: 1px solid #d0d0d0; text-align: left; vertical-align: top; }
      th { background: #f0f4f8; font-weight: 700; font-size: 10px; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.center, th.center { text-align: center; }
      .note { background: #fff8e1; border-left: 3px solid #f59e0b; padding: 6px 10px; margin: 4px 0 12px; font-size: 10px; }
      .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
      .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 9px; color: #888; text-align: center; }
      @media print { body { padding: 12mm; } h3 { page-break-after: avoid; } table { page-break-inside: auto; } tr { page-break-inside: avoid; } }
    </style></head><body>
    <h1>Riwayat Pengeluaran — Barcelona Trip</h1>
    <div class="meta">Dicetak ${new Date().toLocaleString("id-ID")} · ${expenses.length} transaksi · Total ${fmtEUR(grandTotal)} (${fmtIDR(grandTotal)})</div>

    <h2>Detail Per Hari</h2>
    ${dayBlocks || '<p class="muted">Belum ada data.</p>'}

    <div class="summary">
      <div>
        <h2>Ringkasan Reimbursement</h2>
        <table>
          <thead><tr><th>Kategori</th><th class="center">Tx</th><th class="num">EUR</th><th class="num">IDR</th></tr></thead>
          <tbody>${reimbRows || '<tr><td colspan="4" class="muted">—</td></tr>'}
          <tr style="font-weight:700;background:#f0f4f8"><td>TOTAL</td><td class="center">${expenses.length}</td><td class="num">${fmtEUR(grandTotal)}</td><td class="num">${fmtIDR(grandTotal)}</td></tr></tbody>
        </table>
      </div>
      <div>
        <h2>Out of Pocket</h2>
        <table>
          <tbody>
            <tr><td>Transaksi perlu reimburse</td><td class="num">${oop.length}</td></tr>
            <tr><td>Total EUR</td><td class="num">${fmtEUR(oopTotal)}</td></tr>
            <tr><td>Total IDR</td><td class="num">${fmtIDR(oopTotal)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <h2>Definisi & Mapping Akun Reimbursement</h2>
    <table>
      <thead><tr><th>Akun</th><th>Definisi</th><th>Kategori Pengeluaran</th></tr></thead>
      <tbody>
        ${Object.entries(REIMBURSEMENT_CATEGORIES).map(([rKey, rc]) => {
          const sources = Object.entries(CATEGORY_TO_REIMBURSEMENT)
            .filter(([, r]) => r === rKey)
            .map(([cKey]) => CATEGORIES[cKey]?.label)
            .filter(Boolean);
          return `<tr>
            <td><strong>${escapeHtml(rc.label)}</strong></td>
            <td>${escapeHtml(rc.definition)}</td>
            <td>${sources.length ? sources.map(escapeHtml).join(", ") : "<em>—</em>"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>

    <div class="footer">Barcelona Trip Expense Tracker · Pilih "Save as PDF" di dialog print untuk export</div>
    <script>window.onload = () => { setTimeout(() => window.print(), 250); };</script>
    </body></html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Popup diblokir. Izinkan popup untuk export PDF."); return; }
  win.document.write(html);
  win.document.close();
};

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
  const reimb = REIMBURSEMENT_CATEGORIES[reimbursementOf(expense)];
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
        <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>{cat.label} · {expense.time}</span>
          {reimb && (
            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: `${reimb.color}22`, color: reimb.color, fontWeight: 600 }}>
              {reimb.icon} {reimb.label}
            </span>
          )}
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
      <button onClick={() => onDelete(expense.id)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 20, padding: "0 2px", lineHeight: 1 }}>×</button>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "9px 10px", borderRadius: 8, background: "#0f172a", border: "1px solid #2d3f60", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" };

/**
 * Reference card: definition of each reimbursement account
 * and which expense categories map into it.
 */
function ReimbursementMapping() {
  const [open, setOpen] = useState(false);

  const reverseMap = Object.entries(REIMBURSEMENT_CATEGORIES).reduce((acc, [rKey]) => {
    acc[rKey] = Object.entries(CATEGORY_TO_REIMBURSEMENT)
      .filter(([, r]) => r === rKey)
      .map(([cKey]) => CATEGORIES[cKey])
      .filter(Boolean);
    return acc;
  }, {});

  return (
    <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, marginBottom: 14, overflow: "hidden" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          📚 Definisi & Mapping Akun Reimbursement
        </div>
        <span style={{ color: "#64748b", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>
            Setiap pengeluaran dipetakan otomatis ke salah satu akun reimbursement di bawah. Bisa di-override manual saat input.
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #2d3f60" }}>
                <th style={{ textAlign: "left", padding: "8px 6px", color: "#94a3b8", fontWeight: 600, fontSize: 11 }}>Akun</th>
                <th style={{ textAlign: "left", padding: "8px 6px", color: "#94a3b8", fontWeight: 600, fontSize: 11 }}>Definisi & Kategori Pengeluaran</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(REIMBURSEMENT_CATEGORIES).map(([key, rc]) => (
                <tr key={key} style={{ borderBottom: "1px solid #1e293b", verticalAlign: "top" }}>
                  <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "inline-block", padding: "3px 9px", borderRadius: 10, background: `${rc.color}22`, color: rc.color, fontWeight: 700, fontSize: 12 }}>
                      {rc.icon} {rc.label}
                    </div>
                  </td>
                  <td style={{ padding: "10px 6px", color: "#cbd5e1", lineHeight: 1.5 }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5 }}>{rc.definition}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {reverseMap[key].length === 0 && (
                        <span style={{ fontSize: 11, color: "#475569", fontStyle: "italic" }}>— (manual override saja)</span>
                      )}
                      {reverseMap[key].map((cat, i) => (
                        <span key={i} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 8, background: "#0f172a", border: `1px solid ${cat.color}40`, color: cat.color }}>
                          {cat.icon} {cat.label}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Manual expense entry form.
 * @param {Object} props
 * @param {Function} props.onAdd - Callback to add an expense
 */
function AddExpensePanel({ onAdd }) {
  const [form, setForm] = useState({ amount: "", currency: "EUR", category: "lunch", reimbursement: CATEGORY_TO_REIMBURSEMENT.lunch, reimbursementTouched: false, description: "", date: barcelonaToday(), outOfPocket: false });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const requiresSpecify = CATEGORIES[form.category]?.requiresSpecify;
  const isForeign = form.currency !== "IDR";

  const handleCategoryChange = (category) => {
    setForm(f => ({
      ...f,
      category,
      reimbursement: f.reimbursementTouched ? f.reimbursement : (CATEGORY_TO_REIMBURSEMENT[category] || "others"),
    }));
  };

  const handleReimbursementChange = (reimbursement) => {
    setForm(f => ({ ...f, reimbursement, reimbursementTouched: true }));
  };

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
      reimbursement: form.reimbursement,
      description: form.description || CATEGORIES[form.category].label,
      date: form.date,
      time: barcelonaTime(),
      outOfPocket: form.outOfPocket,
    });
    setForm({ amount: "", currency: form.currency, category: form.category, reimbursement: form.reimbursement, reimbursementTouched: false, description: "", date: barcelonaToday(), outOfPocket: false });
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

      {/* Category + Reimbursement Bucket */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Kategori</div>
          <select value={form.category} onChange={e => handleCategoryChange(e.target.value)} style={inputStyle}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
            Reimbursement {form.reimbursementTouched && <span style={{ color: "#fbbf24" }}>· manual</span>}
          </div>
          <select value={form.reimbursement} onChange={e => handleReimbursementChange(e.target.value)} style={inputStyle}>
            {Object.entries(REIMBURSEMENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
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
            : (
              <>
                <button
                  onClick={() => exportHistoryToPDF(expenses, notes)}
                  style={{
                    width: "100%", padding: 11, marginBottom: 14, borderRadius: 9, border: "none",
                    background: "linear-gradient(135deg,#dc2626,#b91c1c)", color: "#fff",
                    fontWeight: 700, fontSize: 13, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  📄 Export Riwayat ke PDF
                </button>
                {sortedDates.map(date => (
                  <DayCard key={date} date={date} expenses={byDate[date]}
                    note={notes[date] ?? null}
                    onDelete={handleDelete}
                    onSaveNote={handleSaveNote} />
                ))}
              </>
            )
        )}

        {/* Tab: Budget */}
        {activeTab === "budget" && (
          <>
            <ReimbursementMapping />
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

            {/* Reimbursement breakdown */}
            <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>Per Reimbursement Category</div>
              {Object.entries(REIMBURSEMENT_CATEGORIES).map(([key, rc]) => {
                const items = expenses.filter(e => reimbursementOf(e) === key);
                const t = sumExpenses(items);
                if (!t) return null;
                const pct = totalVariable > 0 ? (t / totalVariable) * 100 : 0;
                return (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: "#e2e8f0" }}>{rc.icon} {rc.label} <span style={{ color: "#64748b", fontSize: 11 }}>· {items.length} tx</span></span>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: rc.color }}>{fmtEUR(t)}</div>
                        <div style={{ fontSize: 10, color: "#475569" }}>{fmtIDR(t)}</div>
                      </div>
                    </div>
                    <div style={{ height: 4, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: rc.color, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
              {totalVariable === 0 && <div style={{ textAlign: "center", color: "#475569", fontSize: 13, padding: "20px 0" }}>Belum ada pengeluaran</div>}
            </div>

            {/* Out of pocket summary */}
            {(() => {
              const oop = expenses.filter(e => e.outOfPocket);
              const oopTotal = sumExpenses(oop);
              if (!oop.length) return null;
              return (
                <div style={{ background: "#1a2744", border: "1px solid #78350f", borderRadius: 14, padding: 18, marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>💵 Out of Pocket (Reimburse)</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, color: "#cbd5e1" }}>{oop.length} transaksi perlu reimburse</div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#fbbf24" }}>{fmtEUR(oopTotal)}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtIDR(oopTotal)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Category breakdown */}
            <div style={{ background: "#1a2744", border: "1px solid #2d3f60", borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>Per Kategori (Detail)</div>
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
