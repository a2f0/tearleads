import type { DocumentClientProjectionDefinition } from "@tearleads/client-sdk";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readBirthCertificateFieldsFromRecord } from "../document-types/birth-certificate/birthCertificateDocumentDefinition";
import { createDocumentSqlProjection } from "./createDocumentSqlProjection";

const birthCertificateProjection = sqliteTable("birth_certificate_projection", {
  localId: text("local_id").primaryKey(),
  documentId: text("document_id"),
  containerId: text("container_id"),
  certificateNumber: text("certificate_number").notNull().default(""),
  fullName: text("full_name").notNull().default(""),
  dateOfBirth: text("date_of_birth").notNull().default(""),
  placeOfBirth: text("place_of_birth").notNull().default(""),
  parentNames: text("parent_names").notNull().default(""),
  issuingAuthority: text("issuing_authority").notNull().default(""),
  dateIssued: text("date_issued").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const birthCertificateClientProjection: DocumentClientProjectionDefinition =
  createDocumentSqlProjection(birthCertificateProjection, (input) => {
    const fields = readBirthCertificateFieldsFromRecord(
      input.structuredFields,
    ).fields;
    return {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      certificateNumber: fields.certificateNumber,
      fullName: fields.fullName,
      dateOfBirth: fields.dateOfBirth,
      placeOfBirth: fields.placeOfBirth,
      parentNames: fields.parentNames,
      issuingAuthority: fields.issuingAuthority,
      dateIssued: fields.dateIssued,
      updatedAt: input.updatedAt,
    };
  });
