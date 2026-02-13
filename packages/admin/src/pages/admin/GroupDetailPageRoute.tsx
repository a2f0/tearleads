import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GroupDetailPage } from './GroupDetailPage';

export function GroupDetailPageRoute() {
  const navigate = useNavigate();

  const handleDelete = useCallback(() => {
    navigate('/admin/groups');
  }, [navigate]);

  return <GroupDetailPage onDelete={handleDelete} />;
}
