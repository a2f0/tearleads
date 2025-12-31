import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from './card';

describe('Card', () => {
  it('renders with default classes', () => {
    render(<Card data-testid="card">Content</Card>);

    const card = screen.getByTestId('card');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('data-slot', 'card');
    expect(card.className).toContain('rounded-xl');
    expect(card.className).toContain('border');
    expect(card.className).toContain('bg-card');
  });

  it('applies custom className', () => {
    render(
      <Card data-testid="card" className="custom-class">
        Content
      </Card>
    );

    const card = screen.getByTestId('card');
    expect(card.className).toContain('custom-class');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Card ref={ref}>Content</Card>);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('passes through additional props', () => {
    render(
      <Card data-testid="card" aria-label="Test card">
        Content
      </Card>
    );

    expect(screen.getByTestId('card')).toHaveAttribute(
      'aria-label',
      'Test card'
    );
  });
});

describe('CardHeader', () => {
  it('renders with default classes', () => {
    render(<CardHeader data-testid="header">Header</CardHeader>);

    const header = screen.getByTestId('header');
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute('data-slot', 'card-header');
    expect(header.className).toContain('flex');
    expect(header.className).toContain('flex-col');
    expect(header.className).toContain('p-6');
  });

  it('applies custom className', () => {
    render(
      <CardHeader data-testid="header" className="custom-header">
        Header
      </CardHeader>
    );

    expect(screen.getByTestId('header').className).toContain('custom-header');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CardHeader ref={ref}>Header</CardHeader>);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe('CardTitle', () => {
  it('renders as h3 with default classes', () => {
    render(<CardTitle>Title</CardTitle>);

    const title = screen.getByRole('heading', { level: 3 });
    expect(title).toBeInTheDocument();
    expect(title).toHaveAttribute('data-slot', 'card-title');
    expect(title.className).toContain('font-semibold');
    expect(title.className).toContain('tracking-tight');
  });

  it('applies custom className', () => {
    render(<CardTitle className="custom-title">Title</CardTitle>);

    const title = screen.getByRole('heading', { level: 3 });
    expect(title.className).toContain('custom-title');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(<CardTitle ref={ref}>Title</CardTitle>);

    expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
  });
});

describe('CardDescription', () => {
  it('renders with default classes', () => {
    render(<CardDescription data-testid="desc">Description</CardDescription>);

    const desc = screen.getByTestId('desc');
    expect(desc).toBeInTheDocument();
    expect(desc).toHaveAttribute('data-slot', 'card-description');
    expect(desc.className).toContain('text-muted-foreground');
    expect(desc.className).toContain('text-sm');
  });

  it('applies custom className', () => {
    render(
      <CardDescription data-testid="desc" className="custom-desc">
        Description
      </CardDescription>
    );

    expect(screen.getByTestId('desc').className).toContain('custom-desc');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<CardDescription ref={ref}>Description</CardDescription>);

    expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
  });
});

describe('CardContent', () => {
  it('renders with default classes', () => {
    render(<CardContent data-testid="content">Content</CardContent>);

    const content = screen.getByTestId('content');
    expect(content).toBeInTheDocument();
    expect(content).toHaveAttribute('data-slot', 'card-content');
    expect(content.className).toContain('p-6');
    expect(content.className).toContain('pt-0');
  });

  it('applies custom className', () => {
    render(
      <CardContent data-testid="content" className="custom-content">
        Content
      </CardContent>
    );

    expect(screen.getByTestId('content').className).toContain('custom-content');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CardContent ref={ref}>Content</CardContent>);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe('CardFooter', () => {
  it('renders with default classes', () => {
    render(<CardFooter data-testid="footer">Footer</CardFooter>);

    const footer = screen.getByTestId('footer');
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveAttribute('data-slot', 'card-footer');
    expect(footer.className).toContain('flex');
    expect(footer.className).toContain('items-center');
    expect(footer.className).toContain('p-6');
    expect(footer.className).toContain('pt-0');
  });

  it('applies custom className', () => {
    render(
      <CardFooter data-testid="footer" className="custom-footer">
        Footer
      </CardFooter>
    );

    expect(screen.getByTestId('footer').className).toContain('custom-footer');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CardFooter ref={ref}>Footer</CardFooter>);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe('Card composition', () => {
  it('renders a complete card with all subcomponents', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
          <CardDescription>Card description text</CardDescription>
        </CardHeader>
        <CardContent>Card body content</CardContent>
        <CardFooter>Card footer</CardFooter>
      </Card>
    );

    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByText('Card Title')).toBeInTheDocument();
    expect(screen.getByText('Card description text')).toBeInTheDocument();
    expect(screen.getByText('Card body content')).toBeInTheDocument();
    expect(screen.getByText('Card footer')).toBeInTheDocument();
  });
});
