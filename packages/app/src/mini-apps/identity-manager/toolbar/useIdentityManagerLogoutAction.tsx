import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { useWindowTitleBarAction } from "@tearleads/windowing";

// Stable icon element so an unchanged action structurally matches its
// registration across renders (the registry compares fields with Object.is).
const LOGOUT_ICON = <SignOutIcon aria-hidden size={18} />;

/**
 * Registers the signed-in identity's Log Out button beside Refresh in either
 * host. Signed out, it registers nothing.
 */
export function useIdentityManagerLogoutAction({
  disabled,
  isAuthenticated,
  onLogout,
}: {
  disabled: boolean;
  isAuthenticated: boolean;
  onLogout: () => void;
}) {
  useWindowTitleBarAction(
    isAuthenticated
      ? {
          disabled,
          icon: LOGOUT_ICON,
          id: "identity-manager-logout",
          label: "Log Out",
          onClick: onLogout,
        }
      : null,
  );
}
