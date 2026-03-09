import { render } from '@testing-library/react';
import { highlightText } from './highlightText';

describe('highlightText', () => {
  it('returns plain text when search term is empty', () => {
    const result = highlightText('Hello World', '');
    expect(result).toBe('Hello World');
  });

  it('returns plain text when search term is whitespace only', () => {
    const result = highlightText('Hello World', '   ');
    expect(result).toBe('Hello World');
  });

  it('returns plain text when no match is found', () => {
    const result = highlightText('Hello World', 'xyz');
    expect(result).toBe('Hello World');
  });

  it('highlights matching substring at the beginning', () => {
    const { container } = render(
      <span>{highlightText('Hello World', 'Hello')}</span>
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('Hello');
    expect(container.textContent).toBe('Hello World');
  });

  it('highlights matching substring in the middle', () => {
    const { container } = render(
      <span>{highlightText('Hello World', 'lo Wo')}</span>
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('lo Wo');
  });

  it('highlights matching substring at the end and applies styling', () => {
    const { container } = render(
      <span>{highlightText('Hello World', 'World')}</span>
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('World');
    expect(mark).toHaveClass('bg-warning');
  });

  it('performs case-insensitive matching', () => {
    const { container } = render(
      <span>{highlightText('Hello World', 'HELLO')}</span>
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('Hello');
  });

  it('preserves original case in highlighted text', () => {
    const { container } = render(
      <span>{highlightText('HeLLo WoRLd', 'hello')}</span>
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('HeLLo');
  });
});
