import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  captureContinuityScope,
  continuityDocuments,
  continuityFolders,
  continuityGroups,
  ensureContactsContainer,
  loadContinuityAssets,
} from "app/continuity";
import type { CommandInput } from "../cliContext";
import { legalTermsAgreement } from "../legalTerms";
import { resolveSeedAccount } from "../seedAccount";
import { createSeedRun, seedContinuityDocument } from "../seedDocument";
import { type SeededFolders, seedFolders } from "../seedFolders";
import { memberRecoveryKey, seedRoster } from "../seedRoster";
import type { CliSession } from "../session";
import { apiBaseUrl, apiLabel, withSavedSession } from "./account";

/** Runs `--roster` after the documents synced; null when not requested. */
function seedRequestedRoster(
  input: CommandInput,
  session: CliSession,
  spec: Awaited<ReturnType<typeof loadContinuityAssets>>["spec"],
  signingPrivateKey: Uint8Array,
) {
  if (!input.roster) return null;
  return session.tracer.span("seed roster", () =>
    seedRoster(session, {
      agreeToLegalTerms: legalTermsAgreement(input),
      apiBaseUrl: apiBaseUrl(input),
      groups: continuityGroups(spec),
      signingPrivateKey,
    }),
  );
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function reportSeed(
  input: CommandInput,
  count: {
    readonly purged: number;
    readonly roster: Awaited<ReturnType<typeof seedRoster>> | null;
    readonly folders: SeededFolders;
    readonly synced: number;
  },
) {
  input.context.stdout(
    `Synced ${count.synced} Continuity documents to your ${apiLabel(input)} account.${count.purged ? ` Skipped ${count.purged} permanently deleted.` : ""}`,
  );
  if (count.roster) {
    input.context.stdout(
      `Seeded ${count.roster.members} roster members in ${plural(count.roster.groups, "group")}.`,
    );
  }
  const { folders, notes, grants, additions } = count.folders;
  if (folders) {
    input.context.stdout(
      `Seeded ${plural(folders, "folder")} with ${plural(notes, "note")}${count.roster ? `, ${plural(grants, "new group grant")}, and ${plural(additions, "new member line")}` : ""}.`,
    );
  }
}

/** Import the pinned screenshot dataset into the signed-in personal root. */
export async function seed(input: CommandInput): Promise<void> {
  const count = await withSavedSession(
    input,
    async (session) => {
      const { sdk } = session;
      const { assertCurrent } = captureContinuityScope(sdk);
      const { rootId, signingPrivateKey, folders } = await resolveSeedAccount(
        session,
        input.organizationId,
      );
      const { spec, datasetSha256, readAttachment } =
        await loadContinuityAssets();
      const documents = continuityDocuments(spec);
      assertCurrent();
      const contactsId = await ensureContactsContainer(sdk);
      const run = createSeedRun(session, {
        rootId,
        signingPrivateKey,
        datasetSha256,
        readAttachment,
        folders: new Set([...folders.map((node) => node.id), contactsId]),
      });
      let purged = 0;
      for (const document of documents) {
        const containerId = document.kind === "contact" ? contactsId : rootId;
        const store = await seedContinuityDocument(run, document, containerId);
        if (store === "purged") purged++;
      }
      assertCurrent();
      session.assertNoFailures();
      const roster = await seedRequestedRoster(
        input,
        session,
        spec,
        signingPrivateKey,
      );
      const seededFolders = await session.tracer.span("seed folders", () =>
        seedFolders(
          run,
          continuityFolders(spec),
          roster && {
            apiBaseUrl: apiBaseUrl(input),
            memberRecoveryKey: (contactId) =>
              memberRecoveryKey(signingPrivateKey, contactId),
          },
        ),
      );
      assertCurrent();
      session.assertNoFailures();
      return {
        synced: documents.length - purged,
        purged,
        roster,
        folders: seededFolders,
      };
    },
    {
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      automaticSessionRenewal: false,
    },
  );
  reportSeed(input, count);
}
