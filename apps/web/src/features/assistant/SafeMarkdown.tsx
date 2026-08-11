import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

const assistantMarkdownSchema = {
  tagNames: [
    'a',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'input',
    'li',
    'ol',
    'p',
    'pre',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  attributes: {
    a: ['href'],
    input: [['type', 'checkbox'], ['disabled', true], 'checked'],
  },
  protocols: {
    href: ['http', 'https'],
  },
} satisfies NonNullable<Parameters<typeof rehypeSanitize>[0]>;

function safeUrl(url: string) {
  const normalized = url.trim().toLowerCase();
  return normalized.startsWith('https://') || normalized.startsWith('http://')
    ? url
    : undefined;
}

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="safe-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, assistantMarkdownSchema]]}
        urlTransform={safeUrl}
        components={{
          a: ({ children: linkText, href }) =>
            href ? <a href={href}>{linkText}</a> : <span>{linkText}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
