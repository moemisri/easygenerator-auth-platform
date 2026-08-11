import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SafeMarkdown } from './SafeMarkdown';

describe('SafeMarkdown', () => {
  it('renders useful GFM without trusting it as source-card data', () => {
    render(
      <SafeMarkdown>
        {
          '## Session notes\n\n- [x] Cookie configured\n- [ ] Rotation reviewed\n\n~~Legacy token~~\n\n| Control | State |\n| --- | --- |\n| CSRF | Required |'
        }
      </SafeMarkdown>,
    );

    expect(
      screen.getByRole('heading', { name: 'Session notes' }),
    ).toBeVisible();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText('Legacy token').tagName).toBe('DEL');
    expect(screen.getByRole('table')).toHaveTextContent('CSRF');
    expect(
      screen.queryByRole('heading', { name: 'Sources' }),
    ).not.toBeInTheDocument();
  });

  it('removes raw HTML and event/style attributes rather than executing them', () => {
    const { container } = render(
      <SafeMarkdown>
        {
          '<img src="x" onerror="alert(1)" style="display:block">\n<script>alert(2)</script>\n<p onclick="alert(3)">Unsafe</p>'
        }
      </SafeMarkdown>,
    );

    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container.querySelector('[onclick]')).not.toBeInTheDocument();
    expect(container.querySelector('[style]')).not.toBeInTheDocument();
  });

  it.each(['javascript:', 'data:', 'vbscript:', '//attacker.example/'])(
    'rejects the unsafe %s link form',
    (scheme) => {
      render(<SafeMarkdown>{`[untrusted](${scheme}payload)`}</SafeMarkdown>);

      expect(
        screen.queryByRole('link', { name: 'untrusted' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('untrusted')).toBeVisible();
    },
  );

  it.each(['https://example.com/docs', 'http://example.com/docs'])(
    'keeps a safe %s link in the same tab',
    (url) => {
      render(<SafeMarkdown>{`[public documentation](${url})`}</SafeMarkdown>);

      const link = screen.getByRole('link', { name: 'public documentation' });
      expect(link).toHaveAttribute('href', url);
      expect(link).not.toHaveAttribute('target');
    },
  );
});
