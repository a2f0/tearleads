import type { Icon } from "@phosphor-icons/react";
import { ClipboardIcon } from "@phosphor-icons/react/dist/csr/Clipboard";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { PasswordIcon } from "@phosphor-icons/react/dist/csr/Password";
import { PrinterIcon } from "@phosphor-icons/react/dist/csr/Printer";
import { QrCodeIcon } from "@phosphor-icons/react/dist/csr/QrCode";
import type { ReactNode } from "react";
import { usePasswordKeychain } from "../../../identity/identityKeychain";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import {
  MiniAppField,
  MiniAppStatus,
  MiniAppTextarea,
} from "../../mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../mini-app/rows/MiniAppRow";
import { RecoveryKeyQrCode } from "./RecoveryKeyQrCode";
import type { RecoveryKeyDisclosure } from "./recoveryKeyDisclosure";

/**
 * One action of the recovery key menu: a borderless row with its glyph and a
 * short visible label. `name` is the accessible name. It starts with the label,
 * so speech control can say what it reads, and adds the context the short label
 * leaves to the surrounding section.
 */
function RecoveryKeyAction({
  icon: ActionIcon,
  label,
  name,
  onClick,
}: {
  readonly icon: Icon;
  readonly label: string;
  readonly name: string;
  readonly onClick: () => void;
}) {
  return (
    <li>
      <MiniAppRowButton aria-label={name} onClick={onClick}>
        <ActionIcon aria-hidden size={20} />
        <MiniAppRowText>{label}</MiniAppRowText>
      </MiniAppRowButton>
    </li>
  );
}

export function RecoveryKeyDisplay({
  feedback,
  onHide,
  onRequestDisclosure,
  placeholder,
  revealed,
  qrRevealed,
  seedPhrase,
}: {
  /** The last action's outcome, at the head of what the menu reveals. */
  readonly feedback?: ReactNode;
  readonly onHide: (shown: "reveal" | "qr") => void;
  readonly onRequestDisclosure: (disclosure: RecoveryKeyDisclosure) => void;
  /** Stands where the passphrase and its QR code show, while neither does. */
  readonly placeholder?: ReactNode;
  readonly revealed: boolean;
  readonly qrRevealed: boolean;
  readonly seedPhrase: string | null;
}) {
  const { disablePrinting } = useAppHostConfig();
  const canSaveToKeychain = usePasswordKeychain() !== null;
  if (!seedPhrase) {
    return <MiniAppStatus>No recovery key is available.</MiniAppStatus>;
  }

  return (
    <div className="recovery-key-backup">
      {/* Every action keeps its place: the menu comes before what it reveals,
          and the two reveal toggles swap glyph and label rather than appearing
          and disappearing, so the row just chosen stays under the pointer. */}
      <ul aria-label="Recovery key actions" className="recovery-key-actions">
        <RecoveryKeyAction
          icon={revealed ? EyeSlashIcon : EyeIcon}
          label={revealed ? "Hide" : "View"}
          name={revealed ? "Hide Recovery Key" : "View Recovery Key"}
          onClick={() =>
            revealed ? onHide("reveal") : onRequestDisclosure("reveal")
          }
        />
        <RecoveryKeyAction
          icon={QrCodeIcon}
          label={qrRevealed ? "Hide QR Code" : "QR Code"}
          name={qrRevealed ? "Hide QR Code" : "QR Code for Recovery Key"}
          onClick={() =>
            qrRevealed ? onHide("qr") : onRequestDisclosure("qr")
          }
        />
        {!disablePrinting && (
          <RecoveryKeyAction
            icon={PrinterIcon}
            label="Print"
            name="Print Recovery Key"
            onClick={() => onRequestDisclosure("print")}
          />
        )}
        <RecoveryKeyAction
          icon={DownloadSimpleIcon}
          label="Download"
          name="Download Recovery Key"
          onClick={() => onRequestDisclosure("download")}
        />
        {canSaveToKeychain && (
          <RecoveryKeyAction
            icon={PasswordIcon}
            label="Save"
            name="Save to Password Manager"
            onClick={() => onRequestDisclosure("keychain")}
          />
        )}
        {/* The copy runs once the acknowledgement is typed, and the section's
            status line reports it. */}
        <RecoveryKeyAction
          icon={ClipboardIcon}
          label="Copy"
          name="Copy Recovery Key"
          onClick={() => onRequestDisclosure("copy")}
        />
      </ul>
      <RecoveryKeyRevealed
        feedback={feedback}
        placeholder={placeholder}
        qrRevealed={qrRevealed}
        revealed={revealed}
        seedPhrase={seedPhrase}
      />
    </div>
  );
}

/**
 * What the menu reveals, and how its last action went, in one box a host can
 * place on its own (the backup prompt frames it beside the menu on a wide
 * screen). Nothing renders while there is nothing to show.
 */
function RecoveryKeyRevealed({
  feedback,
  placeholder,
  qrRevealed,
  revealed,
  seedPhrase,
}: {
  readonly feedback: ReactNode;
  readonly placeholder: ReactNode;
  readonly qrRevealed: boolean;
  readonly revealed: boolean;
  readonly seedPhrase: string;
}) {
  const hidden = !revealed && !qrRevealed;
  if (hidden && !placeholder && !feedback) return null;
  return (
    <div className="recovery-key-revealed">
      {feedback}
      {revealed && (
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
      )}
      {qrRevealed && <RecoveryKeyQrCode seedPhrase={seedPhrase} />}
      {hidden && placeholder}
    </div>
  );
}
