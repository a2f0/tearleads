import { index, pgTable, text, timestamp, uuid } from "./columns";

/** Exact compound and standalone organization acknowledgements survive later principal heads. */
export const principalPolicyCommits = pgTable(
  "principal_policy_commits",
  {
    requestHash: text("request_hash").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    groupId: uuid("group_id"),
    requesterUserId: uuid("requester_user_id").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_policy_commits_organization_idx").on(table.organizationId),
    index("principal_policy_commits_group_idx").on(table.groupId),
  ],
);
