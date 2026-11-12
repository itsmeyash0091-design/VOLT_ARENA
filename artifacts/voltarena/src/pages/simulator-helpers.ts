// Pure, non-financial UI helpers: input validation and text formatting only.
export type FieldCheck = { ok: true; value: string } | { ok: false; message: string };

export function checkNumber(raw: string, opts: { label: string; min?: number; max?: number; integer?: boolean; required?: boolean }): FieldCheck | null {
  const t = raw.trim();
  if (!t) return opts.required ? { ok: false, message: `${opts.label} is required.` } : null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return { ok: false, message: `${opts.label} must be a plain number.` };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, message: `${opts.label} must be finite.` };
  if (opts.integer && !Number.isInteger(n)) return { ok: false, message: `${opts.label} must be a whole number.` };
  if (opts.min !== undefined && n < opts.min) return { ok: false, message: `${opts.label} must be at least ${opts.min}.` };
  if (opts.max !== undefined && n > opts.max) return { ok: false, message: `${opts.label} must be at most ${opts.max}.` };
  return { ok: true, value: t };
}

export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  const guarded = typeof v !== 'number' && /^\s*[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
};
export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');

export const inr = (v: number | null | undefined) => v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Python signs: positive worstLoss = loss; negative = even the worst sampled outcome gained.
export function lossLabel(v: number): string {
  return v < 0 ? `${inr(v)} signed loss (negative means gain)` : `${inr(v)} loss`;
}
export function gainLabel(v: number): string {
  return v < 0 ? `${inr(v)} signed gain (all sampled outcomes lost)` : `${inr(v)} gain`;
}
