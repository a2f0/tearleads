import { jsonRecord } from "../jsonRecord";

/** The settings API returns numeric targets that cannot be uploaded again. */
export async function readUploadPlacement(environment: string) {
  const source = jsonRecord(
    Bun.JSONC.parse(
      await Bun.file(
        new URL("../../../api/wrangler.jsonc", import.meta.url),
      ).text(),
    ),
  );
  const tiers = jsonRecord(Reflect.get(source, "env"));
  const tier = jsonRecord(
    tiers[environment === "production" ? "prod" : "staging"],
  );
  const placement = jsonRecord(
    Reflect.get(tier, "placement") ?? Reflect.get(source, "placement"),
  );
  const region: unknown = Reflect.get(placement, "region");
  if (typeof region !== "string" || !region)
    throw new Error("The probe requires the API's explicit region hint.");
  // Deployment must still resolve to exactly the live API's persisted target.
  return { mode: "targeted", region };
}
