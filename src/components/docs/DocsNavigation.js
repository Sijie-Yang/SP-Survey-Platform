import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { ChevronRight, ExpandMore } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { DOC_GROUPS, DOC_TOPICS } from '../../pages/docsTopics';
import { PAPER_TEMPLATE_DOCS } from '../../pages/paperTemplateDocs';
import { RESEARCH_GUIDES } from '../../pages/researchGuides';
import { textOf } from './DocsTopicArticle';

export function docsNavigation(language, communityPages = []) {
  const zh = language === 'zh';
  const leaf = (id, title, href, subtitle) => ({ id, title, href, subtitle });
  const paper = d => leaf(d.id, d.shortCitation, `/docs/${d.id}`, d.name);
  return [
    { id: 'papers', title: zh ? '论文案例与模板' : 'Paper cases & templates', href: '/docs/paper-templates', children: [
      leaf('papers-home', zh ? '全部案例与模板' : 'All cases & templates', '/docs/paper-templates'),
      { id: 'guides', title: zh ? '完整图文指南' : 'Illustrated guides', children: PAPER_TEMPLATE_DOCS.filter(d => RESEARCH_GUIDES[d.id]).map(paper) },
      { id: 'references', title: zh ? '更多模板参考' : 'Template references', children: PAPER_TEMPLATE_DOCS.filter(d => !RESEARCH_GUIDES[d.id]).map(paper) },
    ] },
    { id: 'submit', title: zh ? '投稿' : 'Submit', href: '/contribute', children: [
      leaf('submission-guide', zh ? 'Doc / News 投稿指南' : 'Doc / News Submission', '/docs/doc-news-submission'),
      leaf('submit-doc', zh ? '提交模板教程 / 文档' : 'Submit a tutorial / doc', '/contribute?kind=doc_new'),
      leaf('submit-edit', zh ? '编辑已有文档' : 'Edit an existing doc', '/contribute?kind=doc_edit'),
      leaf('submit-news', zh ? '提交研究新闻' : 'Submit research news', '/contribute?kind=news'),
      leaf('contributions', zh ? '投稿与我的申请' : 'Submit & my contributions', '/contribute'),
    ] },
    { id: 'wiki', title: 'Wiki', href: '/docs', children: [
      leaf('wiki-home', zh ? '知识库总览' : 'Wiki overview', '/docs'),
      ...DOC_GROUPS.filter(g => g.id !== 'contributing').map(g => ({ id: g.id, title: textOf(g.title, language), href: `/docs#${g.id}`, children: DOC_TOPICS.filter(t => t.group === g.id).map(t => leaf(t.id, textOf(t.title, language), `/docs/${t.id}`)) })),
      ...(communityPages.length ? [{ id: 'community', title: zh ? '社区文档' : 'Community docs', children: communityPages.map(p => leaf(p.page_key, p.title, `/docs/${p.page_key}`)) }] : []),
    ] },
  ];
}
export function navigationPath(nodes, href) {
  for (const node of nodes) {
    if (node.children) {
      const path = navigationPath(node.children, href);
      if (path.length) return [node, ...path];
    } else if (node.href === href) return [node];
  }
  return [];
}

/** Disclosure buttons only expand; leaf links only navigate. One open sibling at each level. */
export default function DocsNavigation({ nodes, currentHref, language, onNavigate }) {
  const path = navigationPath(nodes, currentHref);
  const ancestors = path.filter(n => n.children).map(n => n.id);
  const routeBranch = JSON.stringify(ancestors);
  const [expanded, setExpanded] = useState(ancestors);
  const scrollRef = useRef(null);
  useEffect(() => { setExpanded(JSON.parse(routeBranch)); }, [currentHref, routeBranch]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const active = scroller?.querySelector('[aria-current="page"]');
      if (!active) return;
      const bounds = scroller.getBoundingClientRect(), item = active.getBoundingClientRect();
      if (item.top < bounds.top || item.bottom > bounds.bottom) scroller.scrollTop += item.top - bounds.top - bounds.height / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [currentHref, expanded]);
  const renderNodes = (siblings, depth = 0) => siblings.map(node => {
    const active = node.href === currentHref && !node.children;
    if (!node.children) return <Box key={node.id} component={RouterLink} to={node.href} aria-current={active ? 'page' : undefined} onClick={onNavigate}
      sx={{ display: 'block', px: 1.25, py: 1, my: 0.25, borderRadius: 1, textDecoration: 'none', color: active ? 'primary.main' : 'text.secondary', bgcolor: active ? 'action.selected' : 'transparent', fontSize: 13, lineHeight: 1.55, fontWeight: active ? 650 : 400, '&:hover': { bgcolor: 'action.hover', color: 'text.primary' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
      <Box component="span" sx={{ display: 'block', fontWeight: node.subtitle ? 650 : 'inherit' }}>{node.title}</Box>
      {node.subtitle && <Box component="span" sx={{ display: 'block', fontSize: 12, mt: 0.25 }}>{node.subtitle}</Box>}
    </Box>;
    const open = expanded.includes(node.id);
    const selectedBranch = ancestors.includes(node.id);
    return <Box key={node.id} sx={{ mb: depth === 0 ? 1 : 0.5 }}>
      <Button fullWidth color="inherit" aria-expanded={open} aria-controls={`docs-group-${node.id}`} onClick={() => setExpanded(previous => open ? previous.filter(id => id !== node.id) : [...previous.filter(id => !siblings.some(s => s.id === id)), node.id])}
        sx={{ justifyContent: 'flex-start', textAlign: 'left', gap: 0.75, px: 0.75, py: 1, fontSize: depth === 0 ? 14 : 13, fontWeight: depth === 0 ? 700 : 600, lineHeight: 1.5, color: selectedBranch ? 'primary.main' : 'text.primary', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
        {open ? <ExpandMore sx={{ fontSize: 18, flexShrink: 0 }} /> : <ChevronRight sx={{ fontSize: 18, flexShrink: 0 }} />}
        {node.title}
      </Button>
      <Box id={`docs-group-${node.id}`} hidden={!open} sx={{ ml: 1.75, pl: 0.75, borderLeft: 1, borderColor: 'divider' }}>{renderNodes(node.children, depth + 1)}</Box>
    </Box>;
  });
  return <Box component="nav" id="docs-navigation" aria-label="SP-Wiki" ref={scrollRef} sx={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', p: 0.5, height: '100%' }}>
    <Typography variant="overline" color="text.secondary" sx={{ display: 'block', px: 1, mb: 1, fontSize: 10, letterSpacing: '0.1em' }}>SP-Wiki</Typography>
    {renderNodes(nodes)}
  </Box>;
}
