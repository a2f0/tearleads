import {
  createElement,
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppFormControls.css";

export const MiniAppInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function MiniAppInput({ className, ...props }, ref) {
  return (
    <input
      {...props}
      className={classNames("mini-app-input", className)}
      ref={ref}
    />
  );
});

export const MiniAppSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function MiniAppSelect({ className, ...props }, ref) {
  return (
    <select
      {...props}
      className={classNames("mini-app-select", className)}
      ref={ref}
    />
  );
});

export const MiniAppTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function MiniAppTextarea({ className, ...props }, ref) {
  return (
    <textarea
      {...props}
      className={classNames("mini-app-textarea", className)}
      ref={ref}
    />
  );
});

// A borderless text editor that fills its pane, such as a note body. It owns
// only the shared focus treatment; the host lays out and pads the surface.
export const MiniAppEditor = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function MiniAppEditor({ className, ...props }, ref) {
  return (
    <textarea
      {...props}
      className={classNames("mini-app-editor", className)}
      ref={ref}
    />
  );
});

export function MiniAppField({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return createElement("label", {
    ...props,
    className: classNames("mini-app-field", className),
  });
}

export function MiniAppFieldGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return createElement("div", {
    ...props,
    className: classNames("mini-app-field", className),
  });
}
