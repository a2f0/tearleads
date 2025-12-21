import { useCallback } from 'react';
import { Dropzone } from '@/components/ui/dropzone';

export function Home() {
  const handleFilesSelected = useCallback((files: File[]) => {
    console.log('Files selected:', files);
  }, []);

  return <Dropzone onFilesSelected={handleFilesSelected} className="mb-8" />;
}
