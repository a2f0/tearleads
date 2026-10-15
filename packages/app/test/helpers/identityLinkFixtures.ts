import type { Tearleads } from "@tearleads/client-sdk";

const runtimes = new Set<Tearleads>();

export function observeIdentityLinkRuntime(runtime: Tearleads): () => void {
  runtimes.add(runtime);
  return () => {
    runtimes.delete(runtime);
  };
}

/** Simulates a secure exchange from the peer's local keys, never an API lookup. */
export async function createPeerIdentityLink(userId: string): Promise<string> {
  const runtime = [...runtimes].find(
    (candidate) => candidate.session.userId === userId,
  );
  if (!runtime) throw new Error(`No local identity-link runtime for ${userId}`);
  return runtime.userIdentities.createLink("http://localhost:3000");
}
