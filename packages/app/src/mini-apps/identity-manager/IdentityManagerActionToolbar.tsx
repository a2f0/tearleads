import {
  MiniAppButton,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";

export type IdentityBusyState = "authenticate" | "register" | null;

export interface IdentityActionToolbarProps {
  readonly backupKeyPackage: () => Promise<void>;
  readonly canAuthenticate: boolean;
  readonly canExportKeyPackage: boolean;
  readonly canGenerateKey: boolean;
  readonly canRegisterCurrentIdentity: boolean;
  readonly canRestoreKeyPackage: boolean;
  readonly generateKey: () => void;
  readonly handleAuthenticate: () => Promise<void>;
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
  canRegisterCurrentIdentity,
  canRestoreKeyPackage,
  generateKey,
  handleAuthenticate,
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
      {canRestoreKeyPackage && (
        <MiniAppButton onClick={handleRestoreKeyPackageClick}>
          Restore Key Package
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
          Authenticate
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
