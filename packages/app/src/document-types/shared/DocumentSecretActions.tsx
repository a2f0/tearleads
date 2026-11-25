import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import {
  MiniAppButton,
  MiniAppClipboardButton,
} from "../../components/mini-app/MiniAppLayout";

/** The eye that shows or hides a masked value. */
function DocumentRevealButton(params: {
  disabled?: boolean | undefined;
  isRevealed: boolean;
  label: string;
  onToggle: () => void;
}) {
  const action = `${params.isRevealed ? "Hide" : "Show"} ${params.label}`;

  return (
    <MiniAppButton
      aria-label={action}
      aria-pressed={params.isRevealed}
      className="mini-app-icon-button"
      disabled={params.disabled ?? false}
      onClick={params.onToggle}
      title={action}
      variant="ghost"
    >
      {params.isRevealed ? (
        <EyeSlashIcon aria-hidden size={16} />
      ) : (
        <EyeIcon aria-hidden size={16} />
      )}
    </MiniAppButton>
  );
}

/**
 * The trailing controls for a masked field: reveal it, or copy it.
 *
 * Copy is the more useful of the two while the value is masked — the input is a
 * password field when masked, so selecting the text by hand may mean revealing
 * it in front of whoever is looking at the screen. It copies the stored
 * value rather than the mask, and stays available whether or not the field is
 * revealed. The clipboard sits after the eye, at the row's trailing edge, where
 * every other surface in the app puts a copy button.
 */
export function DocumentSecretActions(params: {
  disabled?: boolean | undefined;
  isRevealed: boolean;
  label: string;
  onToggle: () => void;
  value: string | null | undefined;
}) {
  return (
    <>
      <DocumentRevealButton
        disabled={params.disabled ?? false}
        isRevealed={params.isRevealed}
        label={params.label}
        onToggle={params.onToggle}
      />
      {/* Empty stays disabled rather than hidden: the button reserves its slot
          so the eye does not shift sideways as a value is typed in. Ghost, so
          the pair reads as two glyphs on one row rather than a bare eye beside a
          framed button. */}
      <MiniAppClipboardButton
        disabled={params.disabled ?? false}
        label={`Copy ${params.label}`}
        value={params.value}
        variant="ghost"
      />
    </>
  );
}
