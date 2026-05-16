type MiniAppDateValue = Date | number | string | null | undefined;

interface MiniAppDateFormatOptions {
  emptyFallback?: string | undefined;
  locale?: string | string[] | undefined;
  timeZone?: string | undefined;
}

const DEFAULT_EMPTY_FALLBACK = "Unknown";

function formatMiniAppDateValue(
  value: MiniAppDateValue,
  formatOptions: Intl.DateTimeFormatOptions,
  options: MiniAppDateFormatOptions = {},
): string {
  if (value === null || value === undefined || value === "") {
    return options.emptyFallback ?? DEFAULT_EMPTY_FALLBACK;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(options.locale, {
    ...formatOptions,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

export function formatMiniAppDate(
  value: MiniAppDateValue,
  options?: MiniAppDateFormatOptions,
): string {
  return formatMiniAppDateValue(value, { dateStyle: "medium" }, options);
}

export function formatMiniAppDateTime(
  value: MiniAppDateValue,
  options?: MiniAppDateFormatOptions,
): string {
  return formatMiniAppDateValue(
    value,
    { dateStyle: "medium", timeStyle: "short" },
    options,
  );
}
