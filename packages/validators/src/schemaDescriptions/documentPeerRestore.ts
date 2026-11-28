import { describeSchema } from "../jsonSchemaAnnotations";
import { DocumentPeerRestoreAllowRequestSchema } from "../request";
import { DocumentPeerRestoreAllowResponseSchema } from "../response";

describeSchema(
  DocumentPeerRestoreAllowRequestSchema,
  "Authorizes or revokes bounded member restoration of pre-purge peer history on a recovered document.",
  {
    allowMemberRestore:
      "True to let authorized writers replay lost operations up to each pre-purge peer frontier without claiming ownership; false to restrict restoration to each peer's owner and the organization owner.",
  },
);

describeSchema(
  DocumentPeerRestoreAllowResponseSchema,
  "Confirms the updated member-restoration policy on a recovered document's pre-purge peer rows.",
  {
    allowMemberRestore: "The applied member-restoration flag.",
    documentId: "Document id whose pre-purge peer-owner rows were updated.",
    updatedPeerCount:
      "Number of pre-purge peer-owner rows updated for the caller.",
  },
);
