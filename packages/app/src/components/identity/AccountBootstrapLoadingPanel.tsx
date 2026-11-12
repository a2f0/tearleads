import { createContext, useContext } from "react";
import type { AccountBootstrapCopy } from "../../identity/accountBootstrapPhase";
import { MiniAppStatePanel } from "../mini-app/MiniAppLayout";

/** The mini-app access gate supplies progress without blocking local content. */
export const AccountBootstrapProgressContext =
  createContext<AccountBootstrapCopy | null>(null);

/** Account progress while a mini-app loads, then its own local loading copy. */
export function AccountBootstrapLoadingPanel({ title }: { title: string }) {
  const progress = useContext(AccountBootstrapProgressContext);
  return (
    <MiniAppStatePanel
      busy
      description={progress?.description}
      title={progress?.title ?? title}
    />
  );
}
