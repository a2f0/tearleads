import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { OrganizationsAdmin } from './OrganizationsAdmin';

export function OrganizationsAdminPage() {
  const navigate = useNavigate();
  const handleOrganizationSelect = useCallback(
    (organizationId: string) => {
      navigate(`/admin/organizations/${organizationId}`);
    },
    [navigate]
  );

  return <OrganizationsAdmin onOrganizationSelect={handleOrganizationSelect} />;
}
