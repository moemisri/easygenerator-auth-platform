import type { AssistantSource } from '@easygenerator/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SourceCards } from './SourceCards';

describe('SourceCards', () => {
  it('renders only the safe server descriptor fields', () => {
    const descriptor = {
      id: 'security:sessions',
      file: 'docs/assistant-public/security.md',
      heading: '<Session security>',
      excerpt: 'private retrieval excerpt',
      score: 0.99,
    } as AssistantSource & { excerpt: string; score: number };

    const { container } = render(<SourceCards sources={[descriptor]} />);

    expect(screen.getByText('<Session security>')).toBeVisible();
    expect(screen.getByText('docs/assistant-public/security.md')).toBeVisible();
    expect(
      screen.queryByText('private retrieval excerpt'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('0.99')).not.toBeInTheDocument();
    expect(container.querySelector('session')).not.toBeInTheDocument();
  });
});
