import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { OrganizationDetailPage } from './OrganizationDetailPage';

export function OrganizationDetailPageRoute() {
  const navigate = useNavigate();

  const handleDelete = useCallback(() => {
    navigate('/admin/organizations');
  }, [navigate]);

  const handleUserSelect = useCallback(
    (userId: string) => {
      navigate(`/admin/users/${userId}`);
    },
    [navigate]
  );

  const handleGroupSelect = useCallback(
    (groupId: string) => {
      navigate(`/admin/groups/${groupId}`);
    },
    [navigate]
  );

  return (
    <OrganizationDetailPage
      onDelete={handleDelete}
      onUserSelect={handleUserSelect}
      onGroupSelect={handleGroupSelect}
    />
  );
}
