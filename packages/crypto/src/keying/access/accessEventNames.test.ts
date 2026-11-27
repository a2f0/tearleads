// An access event is stored as it was signed. Two strings of its header are
// its signer's free choice, its own id and the device it signed on, and
// Postgres refuses U+0000 in `text`, so each is bounded where an event is
// signed and where it is verified: an event that could not be stored fails
// for its shape, not in the store.
import { expect, test } from "bun:test";
import { MAX_ACCESS_EVENT_NAME_LENGTH } from "@tearleads/validators/util";
import { expectVerificationError } from "../core/verificationError.testFixtures";
import type { AccessEvent } from "../index";
import { verifySignedAccessEvent } from "../index";
import { createSignedContainerEvent } from "./accessEvent.testFixtures";

for (const key of ["eventId", "signerDeviceId"] as const) {
  test(`an access event's ${key} is a bounded string of no control character`, async () => {
    const named = (name: string) =>
      createSignedContainerEvent({ overrides: { [key]: name } });
    const verify = (
      fixture: Awaited<ReturnType<typeof named>>,
      event: AccessEvent,
    ) =>
      verifySignedAccessEvent({
        body: fixture.body,
        event,
        signerPublicKey: fixture.signingPublicKey,
      });

    const longest = await named(
      `${"\u20ac".repeat(MAX_ACCESS_EVENT_NAME_LENGTH - 2)}\u{1f600}`,
    );
    expect((await verify(longest, longest.event)).ok).toBe(true);

    // One character more, or any control character, is refused when the
    // event is signed, and when it is verified, before its signature is.
    await expect(
      named("d".repeat(MAX_ACCESS_EVENT_NAME_LENGTH + 1)),
    ).rejects.toThrow(`access event.${key} may be at most 128 characters`);
    expectVerificationError(
      await verify(longest, {
        ...longest.event,
        [key]: `${longest.event[key]}x`,
      }),
      "invalid_shape",
    );
    // A lone surrogate is no character, and no store keeps one as signed.
    for (const lone of ["\ud800", "\udfff"]) {
      const reason = `access event.${key} must be well-formed Unicode`;
      await expect(named(`dev${lone}ice`)).rejects.toThrow(reason);
      const refused = await verify(longest, {
        ...longest.event,
        [key]: `dev${lone}ice`,
      });
      expectVerificationError(refused, "invalid_shape");
      expect(refused.ok ? "" : refused.error.message).toBe(reason);
    }
    for (const control of ["\u0000", "\n", "\u001f", "\u007f", "\u009f"]) {
      await expect(named(`dev${control}ice`)).rejects.toThrow(
        `access event.${key} may not hold a control character`,
      );
      expectVerificationError(
        await verify(longest, { ...longest.event, [key]: `dev${control}ice` }),
        "invalid_shape",
      );
    }
  });
}
