import { notes } from '@tearleads/db/sqlite';
import {
  FloatingWindow,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions,
  WindowPaneState
} from '@tearleads/window-manager';
import { eq } from 'drizzle-orm';
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNotesContext } from '../context/NotesContext';
import { NotesWindowDetail } from './NotesWindowDetail';
import { NotesWindowList } from './NotesWindowList';
import type { ViewMode } from './NotesWindowMenuBar';
import { NotesWindowMenuBar } from './NotesWindowMenuBar';
import { NotesWindowTableView } from './NotesWindowTableView';
import { useCreateNote } from './shared/useCreateNote';

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
  const {
    databaseState,
    getDatabase,
    vfsKeys,
    auth,
    featureFlags,
    vfsApi,
    vfsItemSync
  } = useNotesContext();
  const { isUnlocked } = databaseState;
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showMarkdownToolbar, setShowMarkdownToolbar] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const errorMessage = deleteError ?? createError;

  const handleSelectNote = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedNoteId(null);
  }, []);

  const handleToggleMarkdownToolbar = useCallback(() => {
    setShowMarkdownToolbar((prev) => !prev);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
  }, []);

  const handleDeleteNote = useCallback(async () => {
    if (!selectedNoteId || !isUnlocked) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const db = getDatabase();
      const updatedAt = new Date();
      await db
        .update(notes)
        .set({ deleted: true, updatedAt })
        .where(eq(notes.id, selectedNoteId));

      if (vfsItemSync) {
        await vfsItemSync.queueItemDeleteAndFlush({
          itemId: selectedNoteId,
          objectType: 'note'
        });
      }

      setSelectedNoteId(null);
    } catch (err) {
      console.error('Failed to delete note:', err);
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete note'
      );
    } finally {
      setDeleting(false);
    }
  }, [selectedNoteId, isUnlocked, getDatabase, vfsItemSync]);

  const handleNewNote = useCreateNote({
    getDatabase,
    onSelectNote: handleSelectNote,
    onError: setCreateError,
    vfsKeys,
    auth,
    featureFlags,
    vfsApi
  });

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
            {selectedNoteId && (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={handleBack}
                data-testid="notes-window-control-back"
              >
                Back
              </WindowControlButton>
            )}
          </WindowControlGroup>
          <WindowControlGroup align="right">
            {selectedNoteId ? (
              <WindowControlButton
                icon={<Trash2 className="h-3 w-3" />}
                onClick={() => {
                  void handleDeleteNote();
                }}
                disabled={deleting}
                data-testid="notes-window-control-delete"
              >
                Delete
              </WindowControlButton>
            ) : (
              <>
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
                <WindowControlButton
                  icon={<RefreshCw className="h-3 w-3" />}
                  onClick={handleRefresh}
                  disabled={!isUnlocked}
                  data-testid="notes-window-control-refresh"
                >
                  Refresh
                </WindowControlButton>
              </>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        {errorMessage && (
          <WindowPaneState
            layout="inline"
            tone="error"
            title={errorMessage}
            className="m-3"
          />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selectedNoteId ? (
            <NotesWindowDetail
              noteId={selectedNoteId}
              showToolbar={showMarkdownToolbar}
            />
          ) : viewMode === 'table' ? (
            <NotesWindowTableView
              onSelectNote={handleSelectNote}
              showDeleted={showDeleted}
              refreshToken={refreshToken}
            />
          ) : (
            <NotesWindowList
              onSelectNote={handleSelectNote}
              showDeleted={showDeleted}
              refreshToken={refreshToken}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
