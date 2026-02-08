import type { ClassicState } from '@rapid/classic';

export const CLASSIC_INITIAL_STATE: ClassicState = {
  tags: [
    { id: 'tag-work', name: 'Work' },
    { id: 'tag-personal', name: 'Personal' },
    { id: 'tag-ideas', name: 'Ideas' }
  ],
  notesById: {
    'note-work-1': {
      id: 'note-work-1',
      title: 'Sprint Priorities',
      body: 'Finalize roadmap and prep release notes.'
    },
    'note-work-2': {
      id: 'note-work-2',
      title: 'Customer Follow-ups',
      body: 'Review feedback from enterprise pilots.'
    },
    'note-personal-1': {
      id: 'note-personal-1',
      title: 'Errands',
      body: 'Pick up groceries and schedule dentist.'
    },
    'note-ideas-1': {
      id: 'note-ideas-1',
      title: 'Classic UX Notes',
      body: 'Keep fast keyboard-first workflows and sortable panes.'
    }
  },
  noteOrderByTagId: {
    'tag-work': ['note-work-1', 'note-work-2'],
    'tag-personal': ['note-personal-1'],
    'tag-ideas': ['note-ideas-1']
  },
  activeTagId: 'tag-work'
};
