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
    const { container } = render(highlightText('Hello World', 'Hello'));
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('Hello');
    expect(container.textContent).toBe('Hello World');
  });

  it('highlights matching substring in the middle', () => {
    const { container } = render(highlightText('Hello World', 'lo Wo'));
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('lo Wo');
  });

  it('highlights matching substring at the end', () => {
    const { container } = render(highlightText('Hello World', 'World'));
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('World');
  });

  it('performs case-insensitive matching', () => {
    const { container } = render(highlightText('Hello World', 'HELLO'));
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('Hello');
  });

  it('preserves original case in highlighted text', () => {
    const { container } = render(highlightText('HeLLo WoRLd', 'hello'));
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent('HeLLo');
  });

  it('applies yellow background styling to mark element', () => {
    const { container } = render(highlightText('Hello World', 'World'));
    const mark = container.querySelector('mark');
    expect(mark).toHaveClass('bg-yellow-200');
  });
});
