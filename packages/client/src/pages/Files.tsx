import { useState } from 'react';
import { FilesList } from '@/components/files';

export function Files() {
  const [showDeleted, setShowDeleted] = useState(false);

  return (
    <FilesList
      showDeleted={showDeleted}
      onShowDeletedChange={setShowDeleted}
      showHeader={true}
    />
  );
}
