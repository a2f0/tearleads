import type { UserSession } from "@symcrypt/client-sdk";
import { CURRENT_SESSION_MUTATION_ID } from "../IdentityManagerConstants";

export function compactIdentifier(value: string | null | undefined): string {
  if (!value) {
    return "None";
  }

  if (value.length <= 24) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

export function getSessionStatusLabel(session: UserSession): string {
  return session.isCurrent ? "Current" : "Active";
}

export function formatSessionIpAddresses(
  ipAddresses: ReadonlyArray<string>,
): string {
  if (ipAddresses.length === 0) {
    return "None";
  }
  const [firstIpAddress] = ipAddresses;
  if (ipAddresses.length === 1) {
    return compactIdentifier(firstIpAddress);
  }

  return `${compactIdentifier(firstIpAddress)}, +${ipAddresses.length - 1}`;
}

export function sessionIpAddressesTitle(
  ipAddresses: ReadonlyArray<string>,
): string {
  return ipAddresses.length === 0 ? "No recorded IPs" : ipAddresses.join(", ");
}

export function sessionIsMutating(
  mutatingSessionId: string | null,
  session: UserSession,
): boolean {
  return (
    mutatingSessionId === session.id ||
    (session.isCurrent && mutatingSessionId === CURRENT_SESSION_MUTATION_ID)
  );
}
