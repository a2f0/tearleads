import { notes, vfsRegistry } from '@tearleads/db/sqlite';
import {
  FloatingWindow,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNotesContext } from '../context/NotesContext';
import { NotesWindowDetail } from './NotesWindowDetail';
import { NotesWindowList } from './NotesWindowList';
import type { ViewMode } from './NotesWindowMenuBar';
import { NotesWindowMenuBar } from './NotesWindowMenuBar';
import { NotesWindowTableView } from './NotesWindowTableView';

interface NotesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  openNoteId?: string | null | undefined;
  openRequestId?: number | undefined;
}

export function NotesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  openNoteId,
  openRequestId
}: NotesWindowProps) {
  const { databaseState, getDatabase, vfsKeys, auth, featureFlags, vfsApi } =
    useNotesContext();
  const { isUnlocked } = databaseState;
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showMarkdownToolbar, setShowMarkdownToolbar] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  const handleSelectNote = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedNoteId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedNoteId(null);
  }, []);

  const handleToggleMarkdownToolbar = useCallback(() => {
    setShowMarkdownToolbar((prev) => !prev);
  }, []);

  const handleNewNote = useCallback(async () => {
    if (!isUnlocked) return;

    try {
      const db = getDatabase();
      const noteId = crypto.randomUUID();
      const now = new Date();

      await db.insert(notes).values({
        id: noteId,
        title: 'Untitled Note',
        content: '',
        createdAt: now,
        updatedAt: now,
        deleted: false
      });

      // Register in VFS if dependencies are available
      if (vfsKeys && auth) {
        const authData = auth.readStoredAuth();
        let encryptedSessionKey: string | null = null;

        if (auth.isLoggedIn()) {
          try {
            const sessionKey = vfsKeys.generateSessionKey();
            encryptedSessionKey = await vfsKeys.wrapSessionKey(sessionKey);
          } catch (err) {
            console.warn('Failed to wrap note session key:', err);
          }
        }

        await db.insert(vfsRegistry).values({
          id: noteId,
          objectType: 'note',
          ownerId: authData.user?.id ?? null,
          encryptedSessionKey,
          createdAt: now
        });

        // Register on server if logged in and feature flag enabled
        if (
          auth.isLoggedIn() &&
          featureFlags?.getFeatureFlagValue('vfsServerRegistration') &&
          encryptedSessionKey &&
          vfsApi
        ) {
          try {
            await vfsApi.register({
              id: noteId,
              objectType: 'note',
              encryptedSessionKey
            });
          } catch (err) {
            console.warn('Failed to register note on server:', err);
          }
        }
      }

      setSelectedNoteId(noteId);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }, [isUnlocked, getDatabase, vfsKeys, auth, featureFlags, vfsApi]);

  useEffect(() => {
    if (!openRequestId || !openNoteId) return;
    setSelectedNoteId(openNoteId);
  }, [openNoteId, openRequestId]);

  return (
    <FloatingWindow
      id={id}
      title={selectedNoteId ? 'Note' : 'Notes'}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={500}
      defaultHeight={450}
      minWidth={350}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <NotesWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showListTableOptions={!selectedNoteId}
          showDeleted={showDeleted}
          onShowDeletedChange={setShowDeleted}
          showMarkdownToolbarOption={Boolean(selectedNoteId)}
          showMarkdownToolbar={showMarkdownToolbar}
          onToggleMarkdownToolbar={handleToggleMarkdownToolbar}
          onNewNote={handleNewNote}
          onClose={onClose}
        />
        <WindowControlBar>
          <WindowControlGroup>
            {selectedNoteId ? (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={handleBack}
                data-testid="notes-window-control-back"
              >
                Back
              </WindowControlButton>
            ) : (
              <WindowControlButton
                icon={<Plus className="h-3 w-3" />}
                onClick={() => {
                  void handleNewNote();
                }}
                disabled={!isUnlocked}
                data-testid="notes-window-control-new"
              >
                New
              </WindowControlButton>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selectedNoteId ? (
            <NotesWindowDetail
              noteId={selectedNoteId}
              onBack={handleBack}
              onDeleted={handleDeleted}
              showToolbar={showMarkdownToolbar}
            />
          ) : viewMode === 'table' ? (
            <NotesWindowTableView
              onSelectNote={handleSelectNote}
              showDeleted={showDeleted}
            />
          ) : (
            <NotesWindowList
              onSelectNote={handleSelectNote}
              showDeleted={showDeleted}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
