import type { Icon } from "@phosphor-icons/react";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { PrinterIcon } from "@phosphor-icons/react/dist/csr/Printer";
import { QrCodeIcon } from "@phosphor-icons/react/dist/csr/QrCode";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppField,
  MiniAppStatus,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../../mini-app/MiniAppLayout";
import { RecoveryKeyQrCode } from "./RecoveryKeyQrCode";
import type { RecoveryKeyDisclosure } from "./recoveryKeyDisclosure";

function RecoveryKeyIconButton({
  icon: ButtonIcon,
  label,
  onClick,
}: {
  readonly icon: Icon;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <MiniAppButton
      aria-label={label}
      className="mini-app-icon-button"
      onClick={onClick}
      title={label}
    >
      <ButtonIcon aria-hidden size={16} />
    </MiniAppButton>
  );
}

export function RecoveryKeyDisplay({
  onHide,
  onRequestDisclosure,
  revealed,
  qrRevealed,
  seedPhrase,
}: {
  readonly onHide: (shown: "reveal" | "qr") => void;
  readonly onRequestDisclosure: (disclosure: RecoveryKeyDisclosure) => void;
  readonly revealed: boolean;
  readonly qrRevealed: boolean;
  readonly seedPhrase: string | null;
}) {
  const { disablePrinting } = useAppHostConfig();
  if (!seedPhrase) {
    return <MiniAppStatus>No recovery key is available.</MiniAppStatus>;
  }

  return (
    <div className="recovery-key-backup">
      {revealed ? (
        <MiniAppField>
          <span>Passphrase</span>
          <MiniAppTextarea
            className="recovery-key-backup-textarea"
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
      {/* Every control keeps its place: the reveal toggles swap glyph and
          label rather than appearing and disappearing, and the copy button
          sits at the trailing edge, where every other surface puts it. */}
      <MiniAppToolbar wrap>
        <RecoveryKeyIconButton
          icon={revealed ? EyeSlashIcon : EyeIcon}
          label={revealed ? "Hide Recovery Key" : "Reveal Recovery Key"}
          onClick={() =>
            revealed ? onHide("reveal") : onRequestDisclosure("reveal")
          }
        />
        <RecoveryKeyIconButton
          icon={QrCodeIcon}
          label={
            qrRevealed ? "Hide Recovery QR Code" : "Reveal Recovery QR Code"
          }
          onClick={() =>
            qrRevealed ? onHide("qr") : onRequestDisclosure("qr")
          }
        />
        {!disablePrinting && (
          <RecoveryKeyIconButton
            icon={PrinterIcon}
            label="Print Recovery Key"
            onClick={() => onRequestDisclosure("print")}
          />
        )}
        <RecoveryKeyIconButton
          icon={DownloadSimpleIcon}
          label="Download Recovery Key"
          onClick={() => onRequestDisclosure("download")}
        />
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
      </MiniAppToolbar>
    </div>
  );
}
