import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GroupsAdmin } from './GroupsAdmin';

export function GroupsAdminPage() {
  const navigate = useNavigate();

  const handleGroupSelect = useCallback(
    (groupId: string) => {
      navigate(`/admin/groups/${groupId}`);
    },
    [navigate]
  );

  return <GroupsAdmin onGroupSelect={handleGroupSelect} />;
}
