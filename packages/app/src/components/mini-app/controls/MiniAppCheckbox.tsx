import { forwardRef, type InputHTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppCheckbox.css";

export const MiniAppCheckbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function MiniAppCheckbox({ className, ...props }, ref) {
  return (
    <input
      {...props}
      className={classNames("mini-app-checkbox", className)}
      ref={ref}
      type="checkbox"
    />
  );
});
