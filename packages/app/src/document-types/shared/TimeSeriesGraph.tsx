import { useEffect, useId, useRef, useState } from "react";
import { TimeSeriesPlot } from "./TimeSeriesPlot";
import {
  prepareTimeSeries,
  type TimeSeries,
  timeSeriesBounds,
} from "./timeSeriesGraphData";
import "./TimeSeriesGraph.css";

interface TimeSeriesGraphProps {
  title: string;
  unit: string;
  series: ReadonlyArray<TimeSeries>;
}

/** Shared, responsive time/value plot. Callers supply measurements in one unit. */
export function TimeSeriesGraph({ title, unit, series }: TimeSeriesGraphProps) {
  const titleId = useId();
  const descriptionId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const prepared = prepareTimeSeries(series);
  const bounds = timeSeriesBounds(prepared);

  return (
    <section className="time-series-graph" aria-labelledby={titleId}>
      <div className="time-series-graph-heading">
        <strong id={titleId}>{title}</strong>
        <span>{unit}</span>
      </div>
      <div className="time-series-graph-viewport" ref={container}>
        {bounds ? (
          <TimeSeriesPlot
            title={title}
            titleId={titleId}
            descriptionId={descriptionId}
            unit={unit}
            series={prepared}
            bounds={bounds}
            width={width}
          />
        ) : (
          <p className="time-series-graph-empty">
            Add a dated measurement to see the graph.
          </p>
        )}
      </div>
      {bounds ? (
        <ul className="time-series-graph-legend" aria-label={`${title} series`}>
          {prepared
            .filter((item) => item.points.length > 0)
            .map((item) => (
              <li key={item.id}>
                <span
                  className={`time-series-graph-key time-series-graph-series--${prepared.indexOf(item) % 2}`}
                  aria-hidden="true"
                />
                {item.label}
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}
