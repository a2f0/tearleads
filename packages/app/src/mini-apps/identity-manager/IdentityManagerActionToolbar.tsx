import {
  MiniAppButton,
  MiniAppField,
  MiniAppSelect,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";
import type { PasskeyAuthenticatorAttachmentMode } from "../../identity/useKeyPackageActions";

export type IdentityBusyState =
  | "authenticate"
  | "passkey-backup"
  | "passkey-restore"
  | "register"
  | null;

export interface IdentityActionToolbarProps {
  readonly backupKeyPackage: () => Promise<void>;
  readonly backupSeedPhrase: () => Promise<void>;
  readonly canAuthenticate: boolean;
  readonly canBackupSeedPhrase: boolean;
  readonly canExportKeyPackage: boolean;
  readonly canGenerateKey: boolean;
  readonly canPasskeyBackupKeyPackage: boolean;
  readonly canPasskeyRestoreKeyPackage: boolean;
  readonly canRegisterCurrentIdentity: boolean;
  readonly canRestoreKeyPackage: boolean;
  readonly canRestoreSeedPhrase: boolean;
  readonly generateKey: () => void;
  readonly handleAuthenticate: () => Promise<void>;
  readonly handlePasskeyBackupKeyPackage: () => Promise<void>;
  readonly handlePasskeyRestoreKeyPackage: () => Promise<void>;
  readonly handleDestroyKeyPair: () => void;
  readonly handleLogoutCurrentSession: () => void;
  readonly handleRegisterIdentity: () => Promise<void>;
  readonly handleRestoreKeyPackageClick: () => void;
  readonly handleRestoreSeedPhraseClick: () => void;
  readonly hasSigningKeyPair: boolean;
  readonly identityBusy: IdentityBusyState;
  readonly isAuthenticated: boolean;
  readonly mutatingSessionId: string | null;
  readonly onPasskeyAuthenticatorAttachmentChange: (
    mode: PasskeyAuthenticatorAttachmentMode,
  ) => void;
  readonly passkeyAuthenticatorAttachment: PasskeyAuthenticatorAttachmentMode;
}

function isPasskeyAuthenticatorAttachmentMode(
  value: string,
): value is PasskeyAuthenticatorAttachmentMode {
  return (
    value === "automatic" || value === "cross-platform" || value === "platform"
  );
}

// The current-session logout lives in the Identity section's overflow menu
// (see IdentityManagerActionsMenu), so it is intentionally not rendered here
// even though the shared props type still carries its handler.
export function IdentityActionToolbar({
  backupKeyPackage,
  backupSeedPhrase,
  canAuthenticate,
  canBackupSeedPhrase,
  canExportKeyPackage,
  canGenerateKey,
  canPasskeyBackupKeyPackage,
  canPasskeyRestoreKeyPackage,
  canRegisterCurrentIdentity,
  canRestoreKeyPackage,
  canRestoreSeedPhrase,
  generateKey,
  handleAuthenticate,
  handlePasskeyBackupKeyPackage,
  handlePasskeyRestoreKeyPackage,
  handleDestroyKeyPair,
  handleRegisterIdentity,
  handleRestoreKeyPackageClick,
  handleRestoreSeedPhraseClick,
  hasSigningKeyPair,
  identityBusy,
  onPasskeyAuthenticatorAttachmentChange,
  passkeyAuthenticatorAttachment,
}: IdentityActionToolbarProps) {
  return (
    <MiniAppToolbar wrap>
      {canGenerateKey && !hasSigningKeyPair && (
        <MiniAppButton onClick={generateKey}>Generate Key Pair</MiniAppButton>
      )}
      {canExportKeyPackage && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void backupKeyPackage()}
        >
          Backup Key Package
        </MiniAppButton>
      )}
      {canBackupSeedPhrase && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void backupSeedPhrase()}
        >
          Backup Seed Phrase
        </MiniAppButton>
      )}
      {canPasskeyBackupKeyPackage && (
        <MiniAppField>
          Passkey authenticator
          <MiniAppSelect
            disabled={identityBusy !== null}
            onChange={(event) => {
              const mode = event.currentTarget.value;
              if (isPasskeyAuthenticatorAttachmentMode(mode)) {
                onPasskeyAuthenticatorAttachmentChange(mode);
              }
            }}
            value={passkeyAuthenticatorAttachment}
          >
            <option value="automatic">Automatic (browser default)</option>
            <option value="platform">Platform (this device)</option>
            <option value="cross-platform">Security key / phone</option>
          </MiniAppSelect>
        </MiniAppField>
      )}
      {canPasskeyBackupKeyPackage && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void handlePasskeyBackupKeyPackage()}
        >
          Backup to Passkey
        </MiniAppButton>
      )}
      {canRestoreKeyPackage && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={handleRestoreKeyPackageClick}
        >
          Restore Key Package
        </MiniAppButton>
      )}
      {canRestoreSeedPhrase && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={handleRestoreSeedPhraseClick}
        >
          Restore Seed Phrase
        </MiniAppButton>
      )}
      {canPasskeyRestoreKeyPackage && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void handlePasskeyRestoreKeyPackage()}
        >
          Restore from Passkey
        </MiniAppButton>
      )}
      {canRegisterCurrentIdentity && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void handleRegisterIdentity()}
        >
          Register
        </MiniAppButton>
      )}
      {canAuthenticate && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void handleAuthenticate()}
        >
          Login
        </MiniAppButton>
      )}
      {hasSigningKeyPair && (
        <MiniAppButton variant="ghost" onClick={handleDestroyKeyPair}>
          Destroy Key Pair
        </MiniAppButton>
      )}
    </MiniAppToolbar>
  );
}
