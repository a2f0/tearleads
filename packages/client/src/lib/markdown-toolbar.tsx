import { Tooltip, TooltipContent, TooltipTrigger } from '@rapid/ui';
import type { ICommand } from '@uiw/react-md-editor';
import type { ButtonHTMLAttributes, ReactElement } from 'react';

type CommandFilter = (command: ICommand, isExtra: boolean) => false | ICommand;

const getTooltipLabel = (command: ICommand): string | undefined => {
  const ariaLabel = command.buttonProps?.['aria-label'];
  if (typeof ariaLabel === 'string' && ariaLabel.trim()) {
    return ariaLabel;
  }

  if (typeof command.name === 'string' && command.name.trim()) {
    return command.name;
  }

  if (typeof command.keyCommand === 'string' && command.keyCommand.trim()) {
    return command.keyCommand;
  }

  return undefined;
};

const stripTitle = (
  buttonProps: ButtonHTMLAttributes<HTMLButtonElement> | null | undefined
): ButtonHTMLAttributes<HTMLButtonElement> | null => {
  if (!buttonProps) {
    return null;
  }

  const { title, ...rest } = buttonProps;
  void title;
  return rest;
};

const renderToolbarButton = (
  command: ICommand,
  disabled: boolean,
  executeCommand: (command: ICommand, name?: string) => void
): ReactElement | null => {
  if (!command.buttonProps) {
    return null;
  }

  const tooltipLabel = getTooltipLabel(command);
  const buttonProps = stripTitle(command.buttonProps);
  const ariaLabel =
    (typeof buttonProps?.['aria-label'] === 'string' &&
      buttonProps?.['aria-label']) ||
    tooltipLabel;

  if (!tooltipLabel) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-name={command.name}
          {...buttonProps}
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
          onClick={(event) => {
            event.stopPropagation();
            executeCommand(command, command.groupName);
          }}
        >
          {command.icon}
        </button>
      </TooltipTrigger>
      <TooltipContent className="z-[10050]">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
};

export const markdownToolbarCommandsFilter: CommandFilter = (command) => {
  if (command.keyCommand === 'help') {
    return false;
  }

  if (command.keyCommand === 'divider') {
    return command;
  }

  if (!command.buttonProps) {
    return command;
  }

  command.buttonProps = stripTitle(command.buttonProps);
  command.render = renderToolbarButton;
  return command;
};
