import { expect, test } from "bun:test";
import { authorizePrincipalStateSigner } from "./principalSignerAuthority";

const CITES_EXTERNAL =
  "Directly authorized principal state cannot cite external authority";
const NOT_ADMIN = "Principal state signer must be an admin";

type Authorizer = "absent" | "allows" | "denies";

async function decide(input: {
  readonly isDirectAdmin: boolean;
  readonly citesExternalAuthority: boolean;
  readonly mayUseExternalAuthority: boolean;
  readonly authorizer: Authorizer;
}): Promise<{ readonly outcome: string; readonly authorizerCalls: number }> {
  let authorizerCalls = 0;
  const allows = input.authorizer === "allows";
  try {
    const authority = await authorizePrincipalStateSigner({
      ...input,
      authorizeExternalAdmin:
        input.authorizer === "absent"
          ? undefined
          : async () => {
              authorizerCalls += 1;
              return allows;
            },
    });
    return { outcome: authority, authorizerCalls };
  } catch (error) {
    expect(error).toMatchObject({ code: "unauthorized_signer" });
    return { outcome: (error as Error).message, authorizerCalls };
  }
}

const authorizers: readonly Authorizer[] = ["absent", "allows", "denies"];

test.each(
  authorizers.flatMap((authorizer) =>
    [true, false].map((mayUseExternalAuthority) => ({
      authorizer,
      mayUseExternalAuthority,
    })),
  ),
)("a direct admin never consults the authorizer (%o)", async (row) => {
  expect(
    await decide({
      ...row,
      isDirectAdmin: true,
      citesExternalAuthority: false,
    }),
  ).toEqual({ outcome: "direct-admin", authorizerCalls: 0 });
  expect(
    await decide({ ...row, isDirectAdmin: true, citesExternalAuthority: true }),
  ).toEqual({ outcome: CITES_EXTERNAL, authorizerCalls: 0 });
});

test.each<[boolean, boolean, Authorizer, string, number]>([
  [true, true, "allows", "external-admin", 1],
  [true, true, "denies", NOT_ADMIN, 1],
  [true, true, "absent", NOT_ADMIN, 0],
  [true, false, "allows", NOT_ADMIN, 0],
  [false, true, "allows", NOT_ADMIN, 0],
  [false, false, "allows", NOT_ADMIN, 0],
  [false, false, "absent", NOT_ADMIN, 0],
])(
  "non-admin signer: cites %p, may use external %p, authorizer %p -> %p",
  async (citesExternalAuthority, mayUseExternalAuthority, authorizer, outcome, authorizerCalls) => {
    expect(
      await decide({
        isDirectAdmin: false,
        citesExternalAuthority,
        mayUseExternalAuthority,
        authorizer,
      }),
    ).toEqual({ outcome, authorizerCalls });
  },
);
