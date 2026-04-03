function formatParts(date, timeZone, options = {}) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
    ...options,
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

export function getLocalTimeParts(date = new Date(), timeZone = 'America/New_York') {
  const parts = formatParts(date, timeZone);
  return {
    year: Number(parts.year || 0),
    month: Number(parts.month || 0),
    day: Number(parts.day || 0),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    second: Number(parts.second || 0),
    weekday: String(parts.weekday || ''),
  };
}

export function formatLocalDateKey(date = new Date(), timeZone = 'America/New_York') {
  const parts = getLocalTimeParts(date, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function formatLocalTimeKey(date = new Date(), timeZone = 'America/New_York') {
  const parts = getLocalTimeParts(date, timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function isWeekdayInZone(date = new Date(), timeZone = 'America/New_York') {
  const weekday = getLocalTimeParts(date, timeZone).weekday;
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
}

export function matchesLocalClock(date = new Date(), timeZone = 'America/New_York', expected = '11:00') {
  return formatLocalTimeKey(date, timeZone) === expected;
}

export function buildSlotKey(mode, date = new Date(), timeZone = 'America/New_York') {
  return `${mode}:${formatLocalDateKey(date, timeZone)}:${formatLocalTimeKey(date, timeZone)}:${timeZone}`;
}

export function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  const utcDate = new Date(Date.UTC(year || 0, (month || 1) - 1, day || 1));
  utcDate.setUTCDate(utcDate.getUTCDate() + Number(days || 0));
  return utcDate.toISOString().slice(0, 10);
}

// Convert a local date/time in an IANA timezone into a UTC ISO string without external dependencies.
export function zonedDateTimeToUtcIso(dateKey, timeValue = '00:00', timeZone = 'America/New_York') {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  const [hour, minute] = String(timeValue || '00:00').split(':').map(Number);
  const utcGuess = new Date(Date.UTC(year || 0, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0));
  const zoned = getLocalTimeParts(utcGuess, timeZone);
  const zonedAsUtc = Date.UTC(
    zoned.year || 0,
    Math.max((zoned.month || 1) - 1, 0),
    zoned.day || 1,
    zoned.hour || 0,
    zoned.minute || 0,
    zoned.second || 0,
  );
  const desiredLocalAsUtc = Date.UTC(year || 0, Math.max((month || 1) - 1, 0), day || 1, hour || 0, minute || 0, 0);
  const corrected = new Date(utcGuess.getTime() - (zonedAsUtc - desiredLocalAsUtc));
  return corrected.toISOString();
}
