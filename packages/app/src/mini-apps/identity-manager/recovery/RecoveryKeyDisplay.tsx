import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppField,
  MiniAppStatus,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import type { RecoveryKeyDisclosure } from "../actions/recoveryKeyDisclosure";
import { RecoveryKeyQrCode } from "./RecoveryKeyQrCode";

export function RecoveryKeyDisplay({
  onHide,
  onRequestDisclosure,
  revealed,
  qrRevealed,
  seedPhrase,
}: {
  readonly onHide: () => void;
  readonly onRequestDisclosure: (disclosure: RecoveryKeyDisclosure) => void;
  readonly revealed: boolean;
  readonly qrRevealed: boolean;
  readonly seedPhrase: string | null;
}) {
  if (!seedPhrase) {
    return <MiniAppStatus>No recovery key is available.</MiniAppStatus>;
  }

  return (
    <div className="identity-manager-recovery-key-form">
      {revealed ? (
        <MiniAppField>
          <span>Passphrase</span>
          <MiniAppTextarea
            className="identity-manager-recovery-key-textarea"
            readOnly
            rows={3}
            spellCheck={false}
            value={seedPhrase}
          />
        </MiniAppField>
      ) : (
        <MiniAppStatus>
          The passphrase is hidden. Reveal it to read it on screen.
        </MiniAppStatus>
      )}
      {qrRevealed && <RecoveryKeyQrCode seedPhrase={seedPhrase} />}
      <MiniAppToolbar wrap>
        <MiniAppClipboardButton
          label="Copy recovery key"
          // Suppress the button's own click-to-copy — the copy runs once the
          // acknowledgement is typed. `value` still drives its disabled state,
          // and the copy is reported through the section's status line.
          onClick={(event) => {
            event.preventDefault();
            onRequestDisclosure("copy");
          }}
          value={seedPhrase}
        />
        <MiniAppButton onClick={() => onRequestDisclosure("download")}>
          Download Recovery Key
        </MiniAppButton>
        {!qrRevealed && (
          <MiniAppButton onClick={() => onRequestDisclosure("qr")}>
            Reveal Recovery QR Code
          </MiniAppButton>
        )}
        {!revealed && (
          <MiniAppButton onClick={() => onRequestDisclosure("reveal")}>
            Reveal Recovery Key
          </MiniAppButton>
        )}
        {(revealed || qrRevealed) && (
          <MiniAppButton onClick={onHide}>
            {qrRevealed && !revealed
              ? "Hide Recovery QR Code"
              : "Hide Recovery Key"}
          </MiniAppButton>
        )}
      </MiniAppToolbar>
    </div>
  );
}
