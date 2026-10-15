import { useCallback } from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { identityLinkAppUrl } from "./identityLinkAppUrl";

export function useIdentityLinks() {
  const sdk = useTearleads();
  const { apiBaseUrl, identityLinkWebUrl } = useAppHostConfig();
  const createLink = useCallback(
    () =>
      sdk.userIdentities.createLink(
        identityLinkAppUrl({
          apiBaseUrl,
          configuredUrl: identityLinkWebUrl,
          currentHref: window.location.href,
        }),
      ),
    [apiBaseUrl, identityLinkWebUrl, sdk],
  );
  const verifyLink = useCallback(
    (link: string) => sdk.userIdentities.verifyLink(link),
    [sdk],
  );
  return { createLink, verifyLink };
}
