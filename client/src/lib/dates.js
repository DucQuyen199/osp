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
