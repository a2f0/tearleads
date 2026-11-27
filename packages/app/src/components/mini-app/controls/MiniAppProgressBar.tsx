import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppProgressBar.css";

type MiniAppProgressTone = "default" | "error" | "muted";

export function MiniAppProgressBar({
  className,
  label,
  percent,
  tone = "default",
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  label: string;
  percent: number;
  tone?: MiniAppProgressTone | undefined;
}) {
  const clamped = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : 0;

  return (
    <div
      {...props}
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={clamped}
      className={classNames(
        "mini-app-progress",
        tone !== "default" && `mini-app-progress--${tone}`,
        className,
      )}
      role="progressbar"
    >
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}
