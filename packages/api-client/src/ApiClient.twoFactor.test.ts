import { expect } from "bun:test";
import { generateSigningKeyPair } from "@tearleads/crypto";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { TwoFactorLoginError } from "./twoFactorLogin";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function serveVerify(status: number, body: Record<string, unknown>) {
  const sent: unknown[] = [];
  server.use(
    http.post(`${apiBaseUrl}/auth/challenge`, () =>
      HttpResponse.json({ challenge: "a".repeat(64) }),
    ),
    http.post(`${apiBaseUrl}/auth/verify`, async ({ request }) => {
      sent.push(await request.json());
      return HttpResponse.json(body, { status });
    }),
  );
  return sent;
}

for (const [status, code] of [
  [401, "two_factor_required"],
  [401, "two_factor_invalid"],
  [429, "two_factor_locked"],
] as const) {
  testApiClient(`a ${code} sign-in is a typed refusal`, async () => {
    serveVerify(status, { authenticated: false, code, error: "Refused" });
    const client = new ApiClient(apiBaseUrl);
    const { signingPrivateKey } = generateSigningKeyPair(new Uint8Array(32));

    const refusal = await client
      .authenticate("b".repeat(64), signingPrivateKey)
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TwoFactorLoginError);
    expect((refusal as TwoFactorLoginError).code).toBe(code);
  });
}

testApiClient("sign-in sends the second factor it is given", async () => {
  const sent = serveVerify(401, { authenticated: false, error: "Refused" });
  const client = new ApiClient(apiBaseUrl);
  const { signingPrivateKey } = generateSigningKeyPair(new Uint8Array(32));
  const twoFactor = { code: "123456", method: "totp", rememberDevice: true };

  await client.authenticate("b".repeat(64), signingPrivateKey, {
    twoFactor: { code: "123456", method: "totp", rememberDevice: true },
    twoFactorDeviceToken: "c".repeat(64),
  });
  expect(sent).toEqual([
    expect.objectContaining({
      twoFactor,
      twoFactorDeviceToken: "c".repeat(64),
    }),
  ]);
});

testApiClient(
  "two-factor management and roster requirement routes",
  async () => {
    const calls: string[] = [];
    const status = {
      enabled: false,
      recoveryCodesRemaining: 0,
      requiredByOrganizationIds: ["org-1"],
      sessionVerified: false,
    };
    server.use(
      http.get(`${apiBaseUrl}/auth/two-factor`, () => {
        calls.push("status");
        return HttpResponse.json(status);
      }),
      http.post(`${apiBaseUrl}/auth/two-factor/enable`, async ({ request }) => {
        calls.push(`enable:${JSON.stringify(await request.json())}`);
        return HttpResponse.json({
          enabled: true,
          recoveryCodes: ["aaaaa-bbbbb"],
        });
      }),
      http.put(
        `${apiBaseUrl}/organizations/${organizationId}/roster/${userId}/two-factor`,
        async ({ request }) => {
          calls.push(`roster:${JSON.stringify(await request.json())}`);
          return HttpResponse.json({ error: "Forbidden" }, { status: 403 });
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);

    expect(await client.getTwoFactorStatusResult()).toEqual({
      data: status,
      ok: true,
    });
    expect(
      await client.enableTwoFactorResult({
        code: "123456",
        rememberDevice: false,
      }),
    ).toEqual({
      data: { enabled: true, recoveryCodes: ["aaaaa-bbbbb"] },
      ok: true,
    });
    const refused = await client.updateOrganizationRosterTwoFactorResult(
      organizationId,
      userId,
      { required: true },
    );
    expect(refused.ok).toBe(false);
    expect(calls).toEqual([
      "status",
      'enable:{"code":"123456","rememberDevice":false}',
      'roster:{"required":true}',
    ]);
  },
);
