interface AdminTranslations {
  redis: string;
  postgres: string;
  groups: string;
  organizations: string;
  users: string;
  compliance: string;
}

export type AdminKeys = keyof AdminTranslations;
