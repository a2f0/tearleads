type MiniAppDateValue = Date | number | string | null | undefined;

interface MiniAppDateFormatOptions {
  emptyFallback?: string | undefined;
  locale?: string | string[] | undefined;
  timeZone?: string | undefined;
}

const DEFAULT_EMPTY_FALLBACK = "Unknown";

function getMiniAppDateOrFallback(
  value: MiniAppDateValue,
  options: MiniAppDateFormatOptions,
): Date | string {
  if (value === null || value === undefined || value === "") {
    return options.emptyFallback ?? DEFAULT_EMPTY_FALLBACK;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date;
}

function formatMiniAppDateObject(
  date: Date,
  formatOptions: Intl.DateTimeFormatOptions,
  options: MiniAppDateFormatOptions,
): string {
  return new Intl.DateTimeFormat(options.locale, {
    ...formatOptions,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

function formatMiniAppDateValue(
  value: MiniAppDateValue,
  formatOptions: Intl.DateTimeFormatOptions,
  options: MiniAppDateFormatOptions = {},
): string {
  const date = getMiniAppDateOrFallback(value, options);
  if (typeof date === "string") {
    return date;
  }

  return formatMiniAppDateObject(date, formatOptions, options);
}

export function formatMiniAppDate(
  value: MiniAppDateValue,
  options?: MiniAppDateFormatOptions,
): string {
  return formatMiniAppDateValue(value, { dateStyle: "medium" }, options);
}

export function formatMiniAppDateTime(
  value: MiniAppDateValue,
  options: MiniAppDateFormatOptions = {},
): string {
  const date = getMiniAppDateOrFallback(value, options);
  if (typeof date === "string") {
    return date;
  }

  const datePart = formatMiniAppDateObject(
    date,
    { dateStyle: "medium" },
    options,
  );
  const timePart = formatMiniAppDateObject(
    date,
    { timeStyle: "short" },
    options,
  );
  return `${datePart}, ${timePart}`;
}
