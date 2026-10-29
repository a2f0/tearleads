import { useCallback } from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import {
  identityLinkAppUrl,
  identityLinkFromToken,
} from "./identityLinkAppUrl";

export function useIdentityLinks() {
  const sdk = useTearleads();
  const { apiBaseUrl, identityLinkWebUrl } = useAppHostConfig();
  const appUrl = useCallback(
    () =>
      identityLinkAppUrl({
        apiBaseUrl,
        configuredUrl: identityLinkWebUrl,
        currentHref: window.location.href,
      }),
    [apiBaseUrl, identityLinkWebUrl],
  );
  const createLink = useCallback(
    () => sdk.userIdentities.createLink(appUrl()),
    [appUrl, sdk],
  );
  const linkFromToken = useCallback(
    (token: string) =>
      identityLinkFromToken(token, {
        apiBaseUrl,
        configuredUrl: identityLinkWebUrl,
        currentHref: window.location.href,
      }),
    [apiBaseUrl, identityLinkWebUrl],
  );
  const verifyLink = useCallback(
    (link: string) => sdk.userIdentities.verifyLink(link),
    [sdk],
  );
  const resolveVerified = useCallback(
    (userId: string) => sdk.userIdentities.resolveVerified(userId),
    [sdk],
  );
  return { createLink, verifyLink, resolveVerified, linkFromToken };
}
