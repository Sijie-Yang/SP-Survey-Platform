import React, { useEffect, useState } from 'react';
import { Box, Breadcrumbs, Button, Container, Drawer, Typography, useMediaQuery, useTheme } from '@mui/material';
import { MenuBook, Close } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import PublicHeader, { PublicFooter } from '../layout/PublicHeader';
import DocsNavigation, { docsNavigation, navigationPath } from './DocsNavigation';

export default function DocsLayout({ children, language, currentHref, currentTitle, communityPages = [], actions }) {
  const desktop = useMediaQuery(useTheme().breakpoints.up('md'), { defaultMatches: true });
  const [drawer, setDrawer] = useState(false);
  const nodes = docsNavigation(language, communityPages);
  const path = navigationPath(nodes, currentHref);
  const zh = language === 'zh';
  useEffect(() => { setDrawer(false); }, [currentHref, desktop]);
  const navigation = <DocsNavigation nodes={nodes} language={language} currentHref={currentHref} onNavigate={() => setDrawer(false)} />;
  return <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
    <PublicHeader />
    <Container maxWidth="xl" sx={{ flex: 1, py: { xs: 2, md: 4 }, display: 'flex', gap: { md: 4, lg: 6 }, justifyContent: { md: 'center' }, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' } }}>
      {desktop ? <Box sx={{ width: 250, flexShrink: 0, position: 'sticky', top: 88, height: 'calc(100vh - 112px)' }}>{navigation}</Box> : <>
        <Button startIcon={<MenuBook />} onClick={() => setDrawer(true)} aria-expanded={drawer} aria-controls={drawer ? 'mobile-docs-navigation' : undefined} sx={{ mb: 2 }}>{zh ? '浏览文档目录' : 'Browse documentation'}</Button>
        <Drawer open={drawer} onClose={() => setDrawer(false)} PaperProps={{ sx: { width: 'min(340px, 90vw)', p: 1.5 } }}>
          <Box id="mobile-docs-navigation" sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}><Button startIcon={<Close />} onClick={() => setDrawer(false)} sx={{ alignSelf: 'flex-end', flexShrink: 0 }}>{zh ? '关闭目录' : 'Close navigation'}</Button>{navigation}</Box>
        </Drawer>
      </>}
      <Box component="main" sx={{ flex: 1, minWidth: 0, maxWidth: 920, width: '100%', pb: 6 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 3 }}>
          <Breadcrumbs aria-label={zh ? '文档路径' : 'Document path'} sx={{ fontSize: 12, '& .MuiBreadcrumbs-li': { maxWidth: { xs: 240, md: 320 } } }}>
            <Box component={RouterLink} to="/docs" sx={{ color: 'text.secondary', textDecoration: 'none' }}>SP-Wiki</Box>
            {path.slice(0, -1).map(node => node.href ? <Box key={node.id} component={RouterLink} to={node.href} sx={{ color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>{node.title}</Box> : <Typography key={node.id} sx={{ fontSize: 'inherit' }} color="text.secondary">{node.title}</Typography>)}
            <Typography sx={{ fontSize: 'inherit', overflowWrap: 'anywhere' }} color="text.primary">{currentTitle || path.at(-1)?.subtitle || path.at(-1)?.title || (zh ? '文档总览' : 'Overview')}</Typography>
          </Breadcrumbs>
          {actions}
        </Box>
        {children}
      </Box>
    </Container>
    <PublicFooter />
  </Box>;
}
