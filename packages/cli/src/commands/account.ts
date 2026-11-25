import type { CommandInput } from "../cliContext";
import { legalTermsAgreement } from "../legalTerms";
import { printable } from "../printable";
import { normalizeRecoveryKey } from "../recoveryKey";
import { registerAccount } from "../registerAccount";
import { type CliSession, type SessionOptions, withSession } from "../session";

/** The API a command talks to: `--api-url`, or else the target's. */
export function apiBaseUrl(input: CommandInput): string {
  return input.apiUrl ?? input.context.apiBaseUrl(input.target);
}

/** How messages name the API: the target, or the `--api-url` origin. */
export function apiLabel(input: CommandInput): string {
  return input.apiUrl ?? input.target;
}

async function requireRecoveryKey({
  context,
  keyFromStdin,
  target,
}: CommandInput): Promise<string> {
  if (keyFromStdin)
    return normalizeRecoveryKey(
      await context.readRecoveryKey("Recovery key: "),
    );
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
  options: Pick<
    SessionOptions,
    "documentProjectors" | "verificationDeadline" | "automaticSessionRenewal"
  > = {},
): Promise<T> {
  const recoveryKey = await requireRecoveryKey(input);
  return withSession(
    {
      apiBaseUrl: apiBaseUrl(input),
      registerShutdown: input.context.registerShutdown,
      recoveryKey,
      ...options,
      tracer: input.tracer,
    },
    work,
  );
}

export async function login(input: CommandInput): Promise<void> {
  const { context, target, tracer } = input;
  const recoveryKey = normalizeRecoveryKey(
    await context.readRecoveryKey("Recovery key: "),
  );
  // Prove the key signs in before keeping it.
  const userId = await withSession(
    { apiBaseUrl: context.apiBaseUrl(target), recoveryKey, tracer },
    async (session) => session.userId,
  );
  await tracer.span("save recovery key in the Keychain", () =>
    context.keyStore.save(target, recoveryKey),
  );
  context.stdout(printable(`Signed in to ${target} as ${userId}.`));
  context.stdout("The recovery key is saved in the Keychain.");
}

export async function register(input: CommandInput): Promise<void> {
  const { context, keyFromStdin, target, tracer } = input;
  const recoveryKey = normalizeRecoveryKey(
    await context.readRecoveryKey("Recovery key: "),
  );
  const account = await registerAccount({
    agreeToLegalTerms: legalTermsAgreement(input),
    apiBaseUrl: apiBaseUrl(input),
    recoveryKey,
    tracer,
  });
  context.stdout(
    printable(
      account.created
        ? `Registered ${account.userId} on ${apiLabel(input)}.`
        : `This recovery key already has an account on ${apiLabel(input)}: ${account.userId}.`,
    ),
  );
  if (keyFromStdin) return;
  await tracer.span("save recovery key in the Keychain", () =>
    context.keyStore.save(target, recoveryKey),
  );
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
    `target        ${input.target} (${apiBaseUrl(input)})`,
    `user          ${userId}`,
    `fingerprint   ${sdk.identity.signingFingerprint ?? "-"}`,
    `organization  ${sdk.session.organizationId ?? "-"}`,
  ]);
  for (const line of lines) input.context.stdout(printable(line));
}
