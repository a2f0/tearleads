import { ClipboardIcon } from "@phosphor-icons/react/dist/csr/Clipboard";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppButton.css";

type MiniAppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  block?: boolean | undefined;
  variant?: "default" | "ghost" | undefined;
};

export const MiniAppButton = forwardRef<HTMLButtonElement, MiniAppButtonProps>(
  function MiniAppButton(
    {
      block = false,
      className,
      type = "button",
      variant = "default",
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        className={classNames(
          "mini-app-button",
          block && "mini-app-button--block",
          variant !== "default" && `mini-app-button--${variant}`,
          className,
        )}
        ref={ref}
        type={type}
      />
    );
  },
);

export function MiniAppClipboardButton({
  className,
  disabled,
  label,
  onClick,
  title,
  value,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "value"> & {
  label: string;
  value: string | null | undefined;
}) {
  const clipboardValue = value ?? "";
  const canCopy = clipboardValue.trim().length > 0;

  return (
    <MiniAppButton
      {...props}
      aria-label={label}
      className={classNames("mini-app-icon-button", className)}
      disabled={disabled || !canCopy}
      onMouseDown={(event) => {
        props.onMouseDown?.(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          !canCopy ||
          typeof navigator === "undefined" ||
          !navigator.clipboard
        ) {
          return;
        }

        void navigator.clipboard
          .writeText(clipboardValue)
          .catch(() => undefined);
      }}
      title={title ?? label}
    >
      <ClipboardIcon aria-hidden size={16} />
    </MiniAppButton>
  );
}
