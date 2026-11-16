import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ClipboardIcon } from "@phosphor-icons/react/dist/csr/Clipboard";
import { CLIPBOARD_COPIED_TITLE, useClipboardCopy } from "./MiniAppButton";
import "./MiniAppCopyValue.css";

/**
 * A shortened id or hash that copies its full form when tapped or clicked.
 *
 * Shortening (`d4ae3bb3-6...4f43a2`) used to leave the full form only in a
 * `title` tooltip, which a touch screen never shows. Here the value itself is
 * the control, with a trailing glyph that marks it copyable and confirms the
 * copy; the tooltip stays for pointer hover. With no value there is nothing to
 * copy, so `display` (a placeholder dash) renders as plain text.
 */
export function MiniAppCopyValue({
  display,
  label,
  value,
}: {
  display: string;
  /** What the value is ("document ID"), for the button's accessible name. */
  label: string;
  value: string | null | undefined;
}) {
  const { copied, copy } = useClipboardCopy();

  if (!value) {
    return display;
  }

  return (
    <button
      aria-label={`Copy ${label}`}
      className="mini-app-copy-value"
      onClick={() => copy(value)}
      title={copied ? CLIPBOARD_COPIED_TITLE : value}
      type="button"
    >
      <span className="mini-app-copy-value-text">{display}</span>
      {copied ? (
        <CheckIcon aria-hidden size={14} />
      ) : (
        <ClipboardIcon aria-hidden size={14} />
      )}
    </button>
  );
}
