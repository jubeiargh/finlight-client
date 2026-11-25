const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Strict RFC 3339 parser: a date, a time, optional fractions and a `Z` or a numeric offset.
 * Returns epoch milliseconds, or `null` when the string is not a valid RFC 3339 timestamp.
 * Unix seconds, dates without a time and times without a zone are rejected.
 */
export function parseRfc3339(value: string): number | null {
  const m = RFC3339.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 60) return null;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  let offsetMinutes = 0;
  if (!m[8]) {
    const offH = Number(m[10]);
    const offM = Number(m[11]);
    if (offH > 23 || offM > 59) return null;
    offsetMinutes = (offH * 60 + offM) * (m[9] === '-' ? -1 : 1);
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  return utc - offsetMinutes * 60_000;
}

/**
 * Parses a timestamp string from the API into a `Date`.
 * Returns `null` for `null`/`undefined` and for anything that is not strict RFC 3339
 * (no lenient platform parsing). The model keeps the original string unchanged.
 */
export function toDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;
  const ms = parseRfc3339(value);
  return ms === null ? null : new Date(ms);
}
