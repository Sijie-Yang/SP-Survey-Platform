import React from 'react';
import { Box } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

export function safeWikiUrl(value) {
  if (typeof value !== 'string' || [...value].some(c => c === '\\' || c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return '';
  if (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value) || /^#[\w-]+$/.test(value)) return value;
  return '';
}
export default function WikiMarkdown({ body }) {
  return <Box sx={{ lineHeight: 1.85, overflowWrap: 'anywhere', '& h2, & h3': { mt: 4, scrollMarginTop: 110 }, '& img': { maxWidth: '100%', height: 'auto' }, '& pre': { overflowX: 'auto', p: 2, bgcolor: 'action.hover' }, '& table': { borderCollapse: 'collapse', width: '100%' }, '& th, & td': { p: 1, border: 1, borderColor: 'divider', minWidth: 130 }, '& blockquote': { borderLeft: 3, borderColor: 'divider', pl: 2, ml: 0, color: 'text.secondary' } }}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml urlTransform={safeWikiUrl} components={{
      h1: ({ children }) => <h2>{children}</h2>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({ src, alt }) => src ? <img src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" /> : null,
      table: ({ children }) => <Box sx={{ overflowX: 'auto' }}><table>{children}</table></Box>,
    }}>{body || ''}</ReactMarkdown>
  </Box>;
}
