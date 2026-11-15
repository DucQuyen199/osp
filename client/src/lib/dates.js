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
