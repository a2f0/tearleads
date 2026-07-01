import {
  MiniAppButton,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";

export type IdentityBusyState =
  | "authenticate"
  | "passkey-backup"
  | "passkey-restore"
  | "register"
  | null;

export interface IdentityActionToolbarProps {
  readonly backupKeyPackage: () => Promise<void>;
  readonly canAuthenticate: boolean;
  readonly canExportKeyPackage: boolean;
  readonly canGenerateKey: boolean;
  readonly canPasskeyBackupKeyPackage: boolean;
  readonly canPasskeyRestoreKeyPackage: boolean;
  readonly canRegisterCurrentIdentity: boolean;
  readonly canRestoreKeyPackage: boolean;
  readonly generateKey: () => void;
  readonly handleAuthenticate: () => Promise<void>;
  readonly handlePasskeyBackupKeyPackage: () => Promise<void>;
  readonly handlePasskeyRestoreKeyPackage: () => Promise<void>;
  readonly handleDestroyKeyPair: () => void;
  readonly handleLogoutCurrentSession: () => void;
  readonly handleRegisterIdentity: () => Promise<void>;
  readonly handleRestoreKeyPackageClick: () => void;
  readonly hasSigningKeyPair: boolean;
  readonly identityBusy: IdentityBusyState;
  readonly isAuthenticated: boolean;
  readonly mutatingSessionId: string | null;
}

export function IdentityActionToolbar({
  backupKeyPackage,
  canAuthenticate,
  canExportKeyPackage,
  canGenerateKey,
  canPasskeyBackupKeyPackage,
  canPasskeyRestoreKeyPackage,
  canRegisterCurrentIdentity,
  canRestoreKeyPackage,
  generateKey,
  handleAuthenticate,
  handlePasskeyBackupKeyPackage,
  handlePasskeyRestoreKeyPackage,
  handleDestroyKeyPair,
  handleLogoutCurrentSession,
  handleRegisterIdentity,
  handleRestoreKeyPackageClick,
  hasSigningKeyPair,
  identityBusy,
  isAuthenticated,
  mutatingSessionId,
}: IdentityActionToolbarProps) {
  return (
    <MiniAppToolbar wrap>
      {canGenerateKey && !hasSigningKeyPair && (
        <MiniAppButton onClick={generateKey}>Generate Key Pair</MiniAppButton>
      )}
      {canExportKeyPackage && (
        <MiniAppButton onClick={() => void backupKeyPackage()}>
          Backup Key Package
        </MiniAppButton>
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
        <MiniAppButton onClick={handleRestoreKeyPackageClick}>
          Restore Key Package
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
      {isAuthenticated && (
        <MiniAppButton
          disabled={mutatingSessionId !== null}
          onClick={handleLogoutCurrentSession}
        >
          Log Out
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
