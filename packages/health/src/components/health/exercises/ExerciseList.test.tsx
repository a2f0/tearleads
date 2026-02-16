import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ExerciseList } from './ExerciseList';

const mockParentExercises = [
  { id: 'pull-up', name: 'Pull-Up' },
  { id: 'back-squat', name: 'Back Squat' }
];

const mockHierarchy = new Map([
  [
    'pull-up',
    [
      { id: 'wide-grip', name: 'Wide Grip Pull-Up', parentId: 'pull-up' },
      { id: 'chin-up', name: 'Chin-Up', parentId: 'pull-up' }
    ]
  ]
]);

describe('ExerciseList', () => {
  it('shows empty state when no exercises', () => {
    render(<ExerciseList parentExercises={[]} hierarchy={new Map()} />);

    expect(screen.getByText('No exercises found')).toBeInTheDocument();
  });

  it('renders parent exercises', () => {
    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={mockHierarchy}
      />
    );

    expect(screen.getByText('Pull-Up')).toBeInTheDocument();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
  });

  it('shows variation count for exercises with children', () => {
    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={mockHierarchy}
      />
    );

    expect(screen.getByText('2 variations')).toBeInTheDocument();
  });

  it('shows singular variation when only one child', () => {
    const singleChildHierarchy = new Map([
      [
        'pull-up',
        [{ id: 'wide-grip', name: 'Wide Grip Pull-Up', parentId: 'pull-up' }]
      ]
    ]);

    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={singleChildHierarchy}
      />
    );

    expect(screen.getByText('1 variation')).toBeInTheDocument();
  });

  it('does not show child exercises initially', () => {
    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={mockHierarchy}
      />
    );

    expect(screen.queryByText('Wide Grip Pull-Up')).not.toBeInTheDocument();
    expect(screen.queryByText('Chin-Up')).not.toBeInTheDocument();
  });

  it('expands to show child exercises when clicked', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={mockHierarchy}
      />
    );

    await user.click(screen.getByText('Pull-Up'));

    expect(screen.getByText('Wide Grip Pull-Up')).toBeInTheDocument();
    expect(screen.getByText('Chin-Up')).toBeInTheDocument();
  });

  it('collapses when clicked again', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={mockHierarchy}
      />
    );

    // Expand
    await user.click(screen.getByText('Pull-Up'));
    expect(screen.getByText('Wide Grip Pull-Up')).toBeInTheDocument();

    // Collapse
    await user.click(screen.getByText('Pull-Up'));
    expect(screen.queryByText('Wide Grip Pull-Up')).not.toBeInTheDocument();
  });

  it('sets aria-expanded on expandable items', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={mockHierarchy}
      />
    );

    const pullUpButton = screen.getByText('Pull-Up').closest('button');
    expect(pullUpButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByText('Pull-Up'));
    expect(pullUpButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not set aria-expanded on items without children', () => {
    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={mockHierarchy}
      />
    );

    const backSquatButton = screen.getByText('Back Squat').closest('button');
    expect(backSquatButton).not.toHaveAttribute('aria-expanded');
  });

  it('does not expand items without children on click', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseList
        parentExercises={mockParentExercises}
        hierarchy={mockHierarchy}
      />
    );

    const backSquatButton = screen.getByText('Back Squat').closest('button');
    if (backSquatButton) {
      await user.click(backSquatButton);
    }

    // Should not crash and should not add aria-expanded
    expect(backSquatButton).not.toHaveAttribute('aria-expanded');
  });
});
