import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ClipboardIcon } from "@phosphor-icons/react/dist/csr/Clipboard";
import {
  type ButtonHTMLAttributes,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from "react";
import { classNames } from "../../shared/classNames";
import { useCurrentWindow } from "../../window/CurrentWindowContext";
import "./MiniAppButton.css";

type MiniAppButtonVariant = "default" | "ghost";

type MiniAppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  block?: boolean | undefined;
  variant?: MiniAppButtonVariant | undefined;
  /** Lays the children out as a centered icon + label row with a small gap. */
  withIcon?: boolean | undefined;
};

export const MiniAppButton = forwardRef<HTMLButtonElement, MiniAppButtonProps>(
  function MiniAppButton(
    {
      block = false,
      className,
      type = "button",
      variant = "default",
      withIcon = false,
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
          withIcon && "mini-app-button--with-icon",
          variant !== "default" && `mini-app-button--${variant}`,
          className,
        )}
        ref={ref}
        type={type}
      />
    );
  },
);

const CLIPBOARD_COPIED_TITLE = "Copied to clipboard";
const CLIPBOARD_COPIED_STATUS_TEXT = "Successfully copied to clipboard";
const CLIPBOARD_COPIED_STATE_DURATION_MS = 1200;

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
  /**
   * A function is resolved on click rather than on render, for values that are
   * expensive to build or that must be captured at the moment of the copy. Such
   * a value is always considered copyable, since emptiness cannot be checked
   * without doing the work the laziness exists to avoid.
   */
  value: string | null | undefined | (() => string);
  /**
   * Carried through to the underlying button, so a copy button can match the
   * controls it sits beside — `ghost` where the row already trades button chrome
   * for bare glyphs (the credit card's reveal toggles). Defaults, like the
   * button itself, to the framed `default`.
   */
  variant?: MiniAppButtonVariant | undefined;
}) {
  const resolveValue = typeof value === "function" ? value : null;
  const staticValue = typeof value === "function" ? "" : (value ?? "");
  const canCopy = resolveValue !== null || staticValue.trim().length > 0;
  const currentWindow = useCurrentWindow();
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const markCopied = () => {
    if (!mountedRef.current) {
      return;
    }
    if (copiedTimeoutRef.current) {
      clearTimeout(copiedTimeoutRef.current);
    }
    setCopied(true);
    currentWindow?.showStatusMessage(CLIPBOARD_COPIED_STATUS_TEXT);
    copiedTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) {
        return;
      }
      setCopied(false);
      copiedTimeoutRef.current = null;
    }, CLIPBOARD_COPIED_STATE_DURATION_MS);
  };

  return (
    <MiniAppButton
      {...props}
      aria-label={label}
      className={classNames(
        "mini-app-icon-button",
        copied && "mini-app-clipboard-button--copied",
        className,
      )}
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

        const resolved = resolveValue ? resolveValue() : staticValue;
        if (resolved.trim().length === 0) {
          return;
        }

        void navigator.clipboard
          .writeText(resolved)
          .then(markCopied)
          .catch(() => undefined);
      }}
      title={copied ? CLIPBOARD_COPIED_TITLE : (title ?? label)}
    >
      {copied ? (
        <CheckIcon aria-hidden size={16} />
      ) : (
        <ClipboardIcon aria-hidden size={16} />
      )}
    </MiniAppButton>
  );
}
