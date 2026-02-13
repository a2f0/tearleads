import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { UsersAdmin } from './UsersAdmin';

export function UsersAdminPage() {
  const navigate = useNavigate();

  const handleUserSelect = useCallback(
    (userId: string) => {
      navigate(`/admin/users/${userId}`);
    },
    [navigate]
  );

  const handleViewAiRequests = useCallback(() => {
    navigate('/admin/users/ai-requests');
  }, [navigate]);

  return (
    <UsersAdmin
      onUserSelect={handleUserSelect}
      onViewAiRequests={handleViewAiRequests}
    />
  );
}
