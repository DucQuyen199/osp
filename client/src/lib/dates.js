const validTimeZone = (zone) => {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(); return true; } catch { return false; }
};

export let businessTimezone = 'UTC';
export const setBusinessTimezone = (zone) => {
  if (validTimeZone(zone)) businessTimezone = zone;
};

export const localDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const localMonth = (date = new Date()) => localDate(date).slice(0, 7);

const businessDateTimeParts = (date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: businessTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(date).map(({ type, value }) => [type, value]));

export const localDateTime = (date = new Date()) => {
  const parts = businessDateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const localTime = (date = new Date()) => {
  const parts = businessDateTimeParts(date);
  return `${parts.hour}:${parts.minute}`;
};

// Convert a datetime-local value interpreted in the tenant's business timezone
// to an ISO instant. For a repeated time at the end of DST, choose the earlier
// occurrence; reject a wall time skipped by the spring DST transition.
export const localDateTimeToIso = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wallDate = new Date(0);
  wallDate.setUTCFullYear(year, month - 1, day);
  wallDate.setUTCHours(hour, minute, 0, 0);
  const wallTime = wallDate.getTime();
  if (!Number.isFinite(wallTime) || new Date(wallTime).toISOString().slice(0, 16) !== value) return '';

  const offsets = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = new Date(wallTime + hours * 60 * 60 * 1000);
    const parts = businessDateTimeParts(probe);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    offsets.add(represented - Math.floor(probe.getTime() / 1000) * 1000);
  }
  const matches = [...offsets]
    .map((offset) => new Date(wallTime - offset))
    .filter((candidate) => localDateTime(candidate) === value)
    .sort((left, right) => left - right);
  return matches[0]?.toISOString() || '';
};

export const addCalendarDays = (value, days) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isInteger(days)) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '';
  date.setUTCDate(date.getUTCDate() + days);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return '';
  return date.toISOString().slice(0, 10);
};

export const addCalendarMonths = (value, months) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isInteger(months)) return '';
  const original = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(original.getTime()) || original.toISOString().slice(0, 10) !== value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const monthIndex = year * 12 + month - 1 + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  if (targetYear < 1 || targetYear > 9999) return '';
  const monthEnd = new Date(0);
  monthEnd.setUTCHours(0, 0, 0, 0);
  monthEnd.setUTCFullYear(targetYear, targetMonth, 0);
  const lastDay = monthEnd.getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
};
