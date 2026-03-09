import type { AdminScopeOrganization } from '@tearleads/shared';
import { useTypedTranslation } from '@/i18n';

interface OrganizationScopeSelectorProps {
  organizations: AdminScopeOrganization[];
  selectedOrganizationId: string | null;
  onSelectOrganization: (organizationId: string | null) => void;
  allowAllOrganizations: boolean;
}

export function OrganizationScopeSelector({
  organizations,
  selectedOrganizationId,
  onSelectOrganization,
  allowAllOrganizations
}: OrganizationScopeSelectorProps) {
  const { t } = useTypedTranslation('admin');

  if (organizations.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor="admin-organization-scope"
        className="font-medium text-muted-foreground text-sm"
      >
        {t('organizationScope')}
      </label>
      <select
        id="admin-organization-scope"
        value={selectedOrganizationId ?? ''}
        onChange={(event) => {
          const value = event.target.value;
          onSelectOrganization(value ? value : null);
        }}
        className="h-10 rounded-md border border-input bg-background px-3 text-base text-foreground"
      >
        {allowAllOrganizations ? (
          <option value="">{t('allOrganizations')}</option>
        ) : null}
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
    </div>
  );
}
