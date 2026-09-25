interface TimeAxisProps {
  minTime: number;
  maxTime: number;
  x: (time: number) => number;
  bottom: number;
}

export function TimeSeriesTimeAxis({
  minTime,
  maxTime,
  x,
  bottom,
}: TimeAxisProps) {
  const ticks =
    minTime === maxTime
      ? [minTime]
      : [minTime, (minTime + maxTime) / 2, maxTime];
  const showTime = maxTime - minTime < 172_800_000;
  return ticks.map((timestamp, index) => {
    const date = new Date(timestamp).toISOString();
    const anchor =
      ticks.length === 1
        ? "middle"
        : index === 0
          ? "start"
          : index === ticks.length - 1
            ? "end"
            : "middle";
    return (
      <g key={timestamp}>
        <line
          className="time-series-graph-axis"
          x1={x(timestamp)}
          x2={x(timestamp)}
          y1={bottom}
          y2={bottom + 4}
        />
        <text x={x(timestamp)} y={bottom + 18} textAnchor={anchor}>
          {date.slice(0, 10)}
          {showTime ? (
            <tspan x={x(timestamp)} dy="14">
              {date.slice(11, 16)}
            </tspan>
          ) : null}
        </text>
      </g>
    );
  });
}

export function TimeSeriesValueAxis({
  ticks,
  y,
  left,
  right,
}: {
  ticks: ReadonlyArray<number>;
  y: (value: number) => number;
  left: number;
  right: number;
}) {
  return ticks.map((value) => (
    <g key={value}>
      <line
        className="time-series-graph-grid"
        x1={left}
        x2={right}
        y1={y(value)}
        y2={y(value)}
      />
      <text
        x={left - 8}
        y={y(value)}
        textAnchor="end"
        dominantBaseline="middle"
      >
        {Number(value.toFixed(2))}
      </text>
    </g>
  ));
}
