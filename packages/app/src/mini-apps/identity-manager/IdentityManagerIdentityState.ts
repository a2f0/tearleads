export function getIdentityState({
  signingKeyPair,
  userId,
}: {
  readonly signingKeyPair: unknown;
  readonly userId: string | null;
}): string {
  if (!signingKeyPair) {
    return "No key pair";
  }

  return userId ? "Registered" : "Local only";
}
