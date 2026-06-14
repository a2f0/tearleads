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
  value: string | null | undefined;
}) {
  const clipboardValue = value ?? "";
  const canCopy = clipboardValue.trim().length > 0;
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

        void navigator.clipboard
          .writeText(clipboardValue)
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
