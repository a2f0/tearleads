import { TimeSeriesTimeAxis, TimeSeriesValueAxis } from "./TimeSeriesAxes";
import type {
  prepareTimeSeries,
  timeSeriesBounds,
} from "./timeSeriesGraphData";

const HEIGHT = 248;
const TOP = 16;
const BOTTOM = 192;
const LEFT = 52;

interface TimeSeriesPlotProps {
  title: string;
  titleId: string;
  descriptionId: string;
  unit: string;
  width: number;
  series: ReturnType<typeof prepareTimeSeries>;
  bounds: NonNullable<ReturnType<typeof timeSeriesBounds>>;
}

export function TimeSeriesPlot({
  title,
  titleId,
  descriptionId,
  unit,
  width,
  series,
  bounds,
}: TimeSeriesPlotProps) {
  const right = width - 24;
  const x = (timestamp: number) =>
    bounds.minTime === bounds.maxTime
      ? (LEFT + right) / 2
      : LEFT +
        ((timestamp - bounds.minTime) / (bounds.maxTime - bounds.minTime)) *
          (right - LEFT);
  const y = (value: number) =>
    BOTTOM -
    ((value - bounds.minY) / (bounds.maxY - bounds.minY)) * (BOTTOM - TOP);
  return (
    <svg
      className="time-series-graph-plot"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <title>{title}</title>
      <desc id={descriptionId}>
        Time on the horizontal axis; values in {unit} on the vertical axis.
        Exact measurements are available in the entries below.
      </desc>
      <TimeSeriesValueAxis
        ticks={bounds.ticks}
        y={y}
        left={LEFT}
        right={right}
      />
      <path
        className="time-series-graph-axis"
        d={`M ${LEFT} ${TOP} V ${BOTTOM} H ${right}`}
      />
      <TimeSeriesTimeAxis
        minTime={bounds.minTime}
        maxTime={bounds.maxTime}
        x={x}
        bottom={BOTTOM}
      />
      <text x={(LEFT + right) / 2} y={HEIGHT - 4} textAnchor="middle">
        Time
      </text>
      {series.map((item, index) => (
        <g
          key={item.id}
          className={`time-series-graph-series time-series-graph-series--${index % 2}`}
        >
          <polyline
            points={item.points
              .map((point) => `${x(point.timestamp)},${y(point.value)}`)
              .join(" ")}
            fill="none"
          />
          {item.points.map((point) => (
            <circle
              key={point.id}
              cx={x(point.timestamp)}
              cy={y(point.value)}
              r="3.5"
            >
              <title>{`${item.label}: ${point.value} ${unit} · ${point.measuredAt.replace("T", " ")}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}
