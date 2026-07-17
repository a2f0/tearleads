import {
  MiniAppButton,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";

export type IdentityBusyState =
  | "authenticate"
  | "register"
  | "transition"
  | null;

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

// The current-session logout lives in the Identity section's overflow menu
// (see IdentityManagerActionsMenu), so it is intentionally not rendered here
// even though the shared props type still carries its handler.
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
  handleRegisterIdentity,
  handleRestoreKeyPackageClick,
  hasSigningKeyPair,
  identityBusy,
}: IdentityActionToolbarProps) {
  return (
    <MiniAppToolbar wrap>
      {canGenerateKey && !hasSigningKeyPair && (
        <MiniAppButton disabled={identityBusy !== null} onClick={generateKey}>
          Generate Key Pair
        </MiniAppButton>
      )}
      {canExportKeyPackage && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void backupKeyPackage()}
        >
          Backup Key Package
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
        <MiniAppButton
          disabled={identityBusy !== null}
          variant="ghost"
          onClick={handleDestroyKeyPair}
        >
          Destroy Key Pair
        </MiniAppButton>
      )}
    </MiniAppToolbar>
  );
}
