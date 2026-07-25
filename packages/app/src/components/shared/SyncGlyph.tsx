import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { classNames } from "./classNames";
import "./SyncGlyph.css";

/**
 * The tones the shared sync glyph paints. Deliberately the same set as the
 * footer indicator's `SyncStatus`, so that model maps across without a lookup
 * table; the Explorer's per-object states fold into it (see the badge).
 */
export type SyncGlyphTone =
  | "loading"
  | "synced"
  | "pending"
  | "error"
  | "billing";

/**
 * One sync vocabulary for the whole app: a coloured dot for the passive states
 * (green synced, red unflushed, muted not-yet-known) and a warning glyph for
 * the two that need the user to act. Shared by the footer-tray indicator and
 * the Explorer's per-object badge so both read identically.
 */
export function SyncGlyph({
  className,
  tone,
}: {
  className?: string | undefined;
  tone: SyncGlyphTone;
}) {
  const glyphClassName = classNames(
    "sync-glyph",
    `sync-glyph--${tone}`,
    className,
  );

  if (tone === "billing" || tone === "error") {
    return (
      <WarningIcon
        aria-hidden
        className={glyphClassName}
        focusable={false}
        size={18}
        weight="fill"
      />
    );
  }

  return (
    <span
      aria-hidden
      className={classNames(glyphClassName, "sync-glyph--dot")}
    />
  );
}
