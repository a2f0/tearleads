import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { OrganizationDetailPage } from './OrganizationDetailPage';

export function OrganizationDetailPageRoute() {
  const navigate = useNavigate();

  const handleDelete = useCallback(() => {
    navigate('/admin/organizations');
  }, [navigate]);

  return <OrganizationDetailPage onDelete={handleDelete} />;
}
