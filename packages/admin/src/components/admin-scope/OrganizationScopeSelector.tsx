import type { AdminScopeOrganization } from '@tearleads/shared';

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
  if (organizations.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor="admin-organization-scope"
        className="font-medium text-muted-foreground text-sm"
      >
        Organization Scope
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
          <option value="">All organizations</option>
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

