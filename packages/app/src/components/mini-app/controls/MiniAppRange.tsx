import { forwardRef, type InputHTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppRange.css";

export const MiniAppRange = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function MiniAppRange({ className, ...props }, ref) {
  return (
    <input
      {...props}
      className={classNames("mini-app-range", className)}
      ref={ref}
      type="range"
    />
  );
});
