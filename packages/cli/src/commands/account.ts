import type { CommandInput } from "../cliContext";
import { normalizeRecoveryKey } from "../recoveryKey";
import { type CliSession, withSession } from "../session";

async function requireRecoveryKey({
  context,
  target,
}: CommandInput): Promise<string> {
  const recoveryKey = await context.keyStore.read(target);
  if (!recoveryKey) {
    throw new Error(
      `Not signed in to ${target}. Run \`tearleads login --env ${target}\` first.`,
    );
  }
  return recoveryKey;
}

/** Runs `work` signed in with the saved recovery key for the target. */
export async function withSavedSession<T>(
  input: CommandInput,
  work: (session: CliSession) => Promise<T>,
): Promise<T> {
  const recoveryKey = await requireRecoveryKey(input);
  return withSession(
    input.context.apiBaseUrl(input.target),
    recoveryKey,
    async (session) => {
      if (input.organizationId) {
        session.sdk.session.setOrganizationId(input.organizationId);
      }
      return work(session);
    },
  );
}

export async function login(input: CommandInput): Promise<void> {
  const { context, target } = input;
  const recoveryKey = normalizeRecoveryKey(
    await context.readRecoveryKey("Recovery key: "),
  );
  // Prove the key signs in before keeping it.
  const userId = await withSession(
    context.apiBaseUrl(target),
    recoveryKey,
    async (session) => session.userId,
  );
  await context.keyStore.save(target, recoveryKey);
  context.stdout(`Signed in to ${target} as ${userId}.`);
  context.stdout("The recovery key is saved in the Keychain.");
}

export async function logout({ context, target }: CommandInput): Promise<void> {
  const removed = await context.keyStore.remove(target);
  context.stdout(
    removed
      ? `Removed the ${target} recovery key from the Keychain.`
      : `No ${target} recovery key was saved.`,
  );
}

export async function whoami(input: CommandInput): Promise<void> {
  const lines = await withSavedSession(input, async ({ sdk, userId }) => [
    `target        ${input.target} (${input.context.apiBaseUrl(input.target)})`,
    `user          ${userId}`,
    `fingerprint   ${sdk.identity.signingFingerprint ?? "-"}`,
    `organization  ${sdk.session.organizationId ?? "-"}`,
  ]);
  for (const line of lines) input.context.stdout(line);
}
