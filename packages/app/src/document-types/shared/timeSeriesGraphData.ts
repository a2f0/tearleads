export interface TimeSeriesPoint {
  id: string;
  measuredAt: string;
  value: number;
}

export interface TimeSeries {
  id: string;
  label: string;
  points: ReadonlyArray<TimeSeriesPoint>;
}

/** Plot stored wall-clock times without reinterpreting them in the viewer's zone. */
export function trackerGraphTimestamp(value: string): number {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(\.\d{1,3})?)?$/u.exec(
      value.trim(),
    );
  if (!match) return Number.NaN;
  const normalized = `${match[1]}:${match[2] ?? "00"}${match[3] ?? ""}`;
  const timestamp = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(timestamp)) return Number.NaN;
  // Date.parse normalizes invalid dates such as February 30. Reject those too.
  return new Date(timestamp).toISOString().slice(0, 19) ===
    normalized.slice(0, 19)
    ? timestamp
    : Number.NaN;
}

export function prepareTimeSeries(series: ReadonlyArray<TimeSeries>) {
  return series.map((item) => ({
    ...item,
    points: item.points
      .map((point) => ({
        ...point,
        timestamp: trackerGraphTimestamp(point.measuredAt),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.timestamp) && Number.isFinite(point.value),
      )
      .sort((left, right) => left.timestamp - right.timestamp),
  }));
}

export function timeSeriesBounds(series: ReturnType<typeof prepareTimeSeries>) {
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const item of series) {
    for (const point of item.points) {
      minTime = Math.min(minTime, point.timestamp);
      maxTime = Math.max(maxTime, point.timestamp);
      minValue = Math.min(minValue, point.value);
      maxValue = Math.max(maxValue, point.value);
    }
  }
  if (!Number.isFinite(minTime)) return null;
  const span = maxValue - minValue || Math.max(Math.abs(minValue) * 0.1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(span / 4));
  const step = (span / 4 / magnitude <= 2 ? 2 : 5) * magnitude;
  const minY = Math.floor((minValue - step / 2) / step) * step;
  const maxY = Math.ceil((maxValue + step / 2) / step) * step;
  const ticks = Array.from(
    { length: Math.round((maxY - minY) / step) + 1 },
    (_, index) => minY + index * step,
  );
  return { minTime, maxTime, minY, maxY, ticks };
}
