import { useContext } from "react";
import { AccountBootstrapProgressContext } from "../../components/identity/AccountBootstrapLoadingPanel";
import { useSystemBootstrap } from "../../providers/system-bootstrap/SystemBootstrapProvider";

/** Only empty collections defer to account restoration or initial workspace setup. */
export function useCollectionStartupPending(count: number): boolean {
  const progress = useContext(AccountBootstrapProgressContext);
  const { isBootstrapping } = useSystemBootstrap();
  return count === 0 && (progress !== null || isBootstrapping);
}
