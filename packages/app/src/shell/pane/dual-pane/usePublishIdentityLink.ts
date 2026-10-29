import { useEffect } from "react";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { identityLinkAppUrl } from "../../../providers/identity-links/identityLinkAppUrl";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useDualPane } from "./useDualPane";
import { usePaneSide } from "./usePaneSide";

/** Publishes this pane's identity link for the other pane to verify. */
export function usePublishIdentityLink(): void {
  const { peerUserIdsEnabled, setLeftIdentityLink, setRightIdentityLink } =
    useDualPane();
  const sdk = useTearleads();
  const { apiBaseUrl, identityLinkWebUrl } = useAppHostConfig();
  const runtime = useTearleadsRuntime();
  const userId = runtime.auth.userId;
  const signingFingerprint = runtime.crypto.signingFingerprint;
  const side = usePaneSide();
  useEffect(() => {
    if (!peerUserIdsEnabled || !userId || !signingFingerprint) {
      return;
    }

    const setter = side === "left" ? setLeftIdentityLink : setRightIdentityLink;
    let active = true;
    let published: string | null = null;
    // The link never leaves this window, so its origin is only launch data
    // (as for a received token); verification uses the token's scope.
    let appUrl = "https://app.tearleads.com";
    try {
      appUrl = identityLinkAppUrl({
        apiBaseUrl,
        configuredUrl: identityLinkWebUrl,
        currentHref: window.location.href,
      });
    } catch {
      // A native host without a configured web app URL keeps the default.
    }
    void sdk.userIdentities.createLink(appUrl).then(
      (link) => {
        if (!active) return;
        published = link;
        setter(link);
      },
      () => undefined,
    );
    return () => {
      active = false;
      setter((current) => (current === published ? null : current));
    };
  }, [
    apiBaseUrl,
    identityLinkWebUrl,
    sdk,
    signingFingerprint,
    userId,
    side,
    peerUserIdsEnabled,
    setLeftIdentityLink,
    setRightIdentityLink,
  ]);
}
