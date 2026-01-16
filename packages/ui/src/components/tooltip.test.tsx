import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './tooltip.js';

describe('Tooltip', () => {
  it('shows tooltip content on hover', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent data-testid="tooltip-content">
            Tooltip text
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument();

    await user.hover(screen.getByText('Hover me'));

    await waitFor(() => {
      expect(screen.getByTestId('tooltip-content')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent(
      'Tooltip text'
    );
  });

  it('applies custom className to TooltipContent', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent
            className="custom-class"
            data-testid="tooltip-content"
          >
            Tooltip text
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await user.hover(screen.getByText('Hover me'));
    await waitFor(() => {
      expect(screen.getByTestId('tooltip-content')).toHaveClass('custom-class');
    });
  });

  it('supports data-testid on TooltipContent', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent data-testid="my-tooltip">Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await user.hover(screen.getByText('Hover me'));
    await waitFor(() => {
      expect(screen.getByTestId('my-tooltip')).toBeInTheDocument();
    });
  });

  it('respects delayDuration prop', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await user.hover(screen.getByText('Hover me'));

    // Tooltip should not appear immediately due to delay
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // But should appear after delay
    await waitFor(
      () => {
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
      },
      { timeout: 200 }
    );
  });
});
