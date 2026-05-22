export interface DateResolution {
  /** Resolved ISO date YYYY-MM-DD, or undefined if ambiguous/unparseable. */
  date?: string;
  /** Optional date range (e.g. for "this week"). Both inclusive, ISO YYYY-MM-DD. */
  range?: { start: string; end: string };
  /** When true, the input was ambiguous and the caller should elicit a specific date. */
  ambiguous: boolean;
  /** Human-readable interpretation, e.g. "this Sunday → 2026-05-24". */
  interpretation: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Format a Date as YYYY-MM-DD in local timezone (avoiding UTC offset issues).
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the weekday index (0=Sunday, 1=Monday, ..., 6=Saturday) from a weekday name.
 */
function getWeekdayIndex(weekday: string): number | undefined {
  const normalized = weekday.toLowerCase();

  const fullIndex = WEEKDAYS.indexOf(normalized);
  if (fullIndex !== -1) return fullIndex;

  const abbrevIndex = WEEKDAY_ABBREVS.indexOf(normalized);
  if (abbrevIndex !== -1) return abbrevIndex;

  return undefined;
}

/**
 * Get the start (Monday) and end (Sunday) of the current week for a given date.
 */
function getWeekRange(date: Date): { start: Date; end: Date } {
  const day = date.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
  const mondayOffset = day === 0 ? -6 : 1 - day; // Handle Sunday as last day of week

  const monday = new Date(date);
  monday.setDate(date.getDate() + mondayOffset);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return { start: monday, end: sunday };
}

/**
 * Get the next occurrence of a specific weekday, relative to today.
 * If includeToday is true and today is that weekday, returns today.
 */
function getNextWeekday(from: Date, targetWeekday: number, includeToday: boolean = true): Date {
  const currentWeekday = from.getDay();
  let daysAhead = targetWeekday - currentWeekday;

  // If target is earlier in the week, or it's today but we don't want to include today
  if (daysAhead < 0 || (daysAhead === 0 && !includeToday)) {
    daysAhead += 7;
  }

  const result = new Date(from);
  result.setDate(from.getDate() + daysAhead);
  return result;
}

/**
 * Check if a string matches the ISO date format YYYY-MM-DD.
 */
function isIsoDate(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

/**
 * Resolve a date string into a structured date resolution.
 */
export function resolveDate(input: string, now: Date = new Date()): DateResolution {
  const normalized = input.trim().toLowerCase();

  // Handle ISO dates
  if (isIsoDate(input)) {
    return {
      date: input,
      ambiguous: false,
      interpretation: input,
    };
  }

  // Handle simple relative dates
  if (normalized === "today") {
    const date = formatLocalDate(now);
    return {
      date,
      ambiguous: false,
      interpretation: `today → ${date}`,
    };
  }

  if (normalized === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const date = formatLocalDate(tomorrow);
    return {
      date,
      ambiguous: false,
      interpretation: `tomorrow → ${date}`,
    };
  }

  if (normalized === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const date = formatLocalDate(yesterday);
    return {
      date,
      ambiguous: false,
      interpretation: `yesterday → ${date}`,
    };
  }

  // Handle week ranges
  if (normalized === "this week") {
    const { start, end } = getWeekRange(now);
    return {
      range: { start: formatLocalDate(start), end: formatLocalDate(end) },
      ambiguous: false,
      interpretation: `this week → ${formatLocalDate(start)} to ${formatLocalDate(end)}`,
    };
  }

  if (normalized === "next week") {
    const nextWeekDate = new Date(now);
    nextWeekDate.setDate(now.getDate() + 7);
    const { start, end } = getWeekRange(nextWeekDate);
    return {
      range: { start: formatLocalDate(start), end: formatLocalDate(end) },
      ambiguous: false,
      interpretation: `next week → ${formatLocalDate(start)} to ${formatLocalDate(end)}`,
    };
  }

  // Handle weekday patterns: "this <weekday>" and "next <weekday>"
  const thisWeekdayMatch = normalized.match(/^this\s+(\w+)$/);
  if (thisWeekdayMatch) {
    const weekdayName = thisWeekdayMatch[1];
    if (!weekdayName) {
      return {
        ambiguous: true,
        interpretation: `Could not parse '${input}'. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.`,
      };
    }

    const weekdayIndex = getWeekdayIndex(weekdayName);
    if (weekdayIndex === undefined) {
      return {
        ambiguous: true,
        interpretation: `Could not parse '${input}'. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.`,
      };
    }

    const targetDate = getNextWeekday(now, weekdayIndex, true);
    const date = formatLocalDate(targetDate);
    return {
      date,
      ambiguous: false,
      interpretation: `this ${weekdayName} → ${date}`,
    };
  }

  const nextWeekdayMatch = normalized.match(/^next\s+(\w+)$/);
  if (nextWeekdayMatch) {
    const weekdayName = nextWeekdayMatch[1];
    if (!weekdayName) {
      return {
        ambiguous: true,
        interpretation: `Could not parse '${input}'. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.`,
      };
    }

    const weekdayIndex = getWeekdayIndex(weekdayName);
    if (weekdayIndex === undefined) {
      return {
        ambiguous: true,
        interpretation: `Could not parse '${input}'. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.`,
      };
    }

    // "next" means always at least 7 days out (following week)
    const currentWeekday = now.getDay();
    let daysAhead = weekdayIndex - currentWeekday;

    if (daysAhead === 0) {
      // We're on the target weekday, so "next" is exactly 7 days away
      daysAhead = 7;
    } else if (daysAhead < 0) {
      // Target weekday already passed this week, so "next" is next week's occurrence
      daysAhead += 14; // Skip this week's (missed) occurrence and go to next week
    } else {
      // Target weekday is coming up this week, but "next" means skip it and go to next week
      daysAhead += 7;
    }

    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysAhead);
    const date = formatLocalDate(targetDate);
    return {
      date,
      ambiguous: false,
      interpretation: `next ${weekdayName} → ${date}`,
    };
  }

  // Fallback for unparseable input
  return {
    ambiguous: true,
    interpretation: `Could not parse '${input}'. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.`,
  };
}
