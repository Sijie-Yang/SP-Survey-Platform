import React, { useCallback, useEffect, useState } from 'react';
import { isChineseLanguage, uiPair } from '../lib/uiLanguages';
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import DocsLayout from '../components/docs/DocsLayout';
import { useAuth } from '../contexts/AuthContext';
import { useRegion } from '../contexts/RegionContext';
import { getWikiPage, listSubmissions, listWikiPages, saveSubmission } from '../lib/contentSubmissionStore';
import { builtinWikiSource, wikiDocuments } from '../lib/wikiSource';
import { PAPER_TEMPLATE_DOCS } from './paperTemplateDocs';
import WikiMarkdown from '../components/docs/WikiMarkdown';
export const submissionStatus = (status, zh) => ({
  pending: uiPair(zh ? "zh" : "en", 'Pending review', '待审核'),
  changes_requested: uiPair(zh ? "zh" : "en", 'Changes requested', '请修改后重投'),
  rejected: uiPair(zh ? "zh" : "en", 'Rejected', '未通过'),
  approved: uiPair(zh ? "zh" : "en", 'Published', '已发布')
})[status] || status;
const blank = (language, kind = 'doc_new', target = '') => ({
  id: crypto.randomUUID(),
  version: 0,
  kind,
  language,
  target_key: target,
  title: '',
  summary: '',
  body: '',
  contributor_name: '',
  change_reason: '',
  source_notes: '',
  template_id: '',
  rights_confirmed: false,
  base_revision: 0,
  base_content: {}
});
export default function ContributePage() {
  const {
    user,
    loading
  } = useAuth();
  const [params] = useSearchParams();
  return <ContributionEditor key={`${user?.id || 'anonymous'}:${params.toString()}`} user={user} loading={loading} />;
}
function ContributionEditor({
  user,
  loading
}) {
  const navigate = useNavigate();
  const userId = user?.id;
  const {
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const [params] = useSearchParams();
  const [form, setForm] = useState(() => blank(params.get('language') === 'en' ? 'en' : params.get('language') === 'zh' ? 'zh' : language, ['doc_edit', 'doc_new', 'news'].includes(params.get('kind')) ? params.get('kind') : 'doc_new', params.get('target') || ''));
  const [rows, setRows] = useState([]);
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(false);
  const [sourceReady, setSourceReady] = useState(false);
  const explainError = (e) => e.missingSchema ? uiPair(language, 'Submissions are not enabled yet. Please try again later.', '投稿功能尚未启用，请稍后再试。') : e.code === '40001' ? uiPair(language, 'The content or review status changed. Reopen the submission or load the latest document and merge your changes.', '内容或审核状态已改变。请重新打开申请，或载入最新文档后合并修改。') : e.message;
  const refresh = useCallback(async () => {
    if (!user) {
      setRows([]);
      return;
    }
    try {
      setRows(await listSubmissions({
        userId: user.id
      }));
      setListError('');
    } catch (e) {
      setListError(e.missingSchema ? uiPair(language, 'Submissions are not enabled yet.', '投稿功能尚未启用。') : e.message);
    }
  }, [user, language]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    let active = true;
    listWikiPages().then((data) => {
      if (active) setPages(data);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!userId || form.kind !== 'doc_edit' || !form.target_key || form.version > 0) return undefined;
    let active = true;
    setSourceReady(false);
    setBusy(true);
    setError('');
    getWikiPage(form.target_key, form.language).then((page) => {
      const source = page || builtinWikiSource(form.target_key, form.language);
      if (!source) throw new Error(form.language === 'zh' ? '找不到要编辑的文档。' : 'The document could not be found.');
      if (active) {
        setForm((f) => ({
          ...f,
          title: source.title,
          summary: source.summary,
          body: source.body,
          base_content: {
            title: source.title,
            summary: source.summary,
            body: source.body
          },
          base_revision: source.revision,
          template_id: source.template_id || (PAPER_TEMPLATE_DOCS.some((d) => d.id === f.target_key) ? f.target_key : '')
        }));
        setSourceReady(true);
      }
    }).catch((e) => {
      if (active) setError(e.missingSchema ? form.language === 'zh' ? '投稿功能尚未启用。' : 'Submissions are not enabled yet.' : e.message);
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [userId, form.kind, form.target_key, form.language, form.version]);
  const field = (key, value) => setForm((f) => ({
    ...f,
    [key]: value
  }));
  const start = (kind) => {
    setForm(blank(language, kind));
    setSourceReady(false);
    setNotice('');
    setError('');
    navigate(`/contribute?kind=${kind}`);
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const row = await saveSubmission(form.id, form.version, form);
      setForm(row);
      setNotice(uiPair(language, 'Submitted. Publication requires administrator review. Track status and feedback below.', '已提交。管理员审核后才会发布；你可以在下方查看状态和反馈。'));
      await refresh();
    } catch (e) {
      setError(explainError(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const rebase = async () => {
    setBusy(true);
    setError('');
    try {
      const source = (await getWikiPage(form.target_key, form.language)) || builtinWikiSource(form.target_key, form.language);
      if (!source) throw new Error(uiPair(language, 'Current document not found.', '找不到当前文档。'));
      setForm((f) => ({
        ...f,
        base_revision: source.revision,
        base_content: {
          title: source.title,
          summary: source.summary,
          body: source.body
        }
      }));
      setSourceReady(true);
      setNotice(uiPair(language, 'Latest source loaded. Your proposal is preserved; compare it with the source below and merge before resubmitting.', '已载入最新原文。你的提案仍在编辑框中；请与下方原文比较、手动合并后重新提交。'));
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };
  const options = [...wikiDocuments(form.language), ...pages.filter((p) => p.language === form.language && p.page_key.startsWith('community-')).map((p) => ({
    key: p.page_key,
    title: p.title
  }))];
  const locked = form.version > 0;
  const currentHref = params.get('kind') ? `/contribute?kind=${form.kind}` : '/contribute';
  const communityPages = [...new Set(pages.filter((p) => p.page_key.startsWith('community-')).map((p) => p.page_key))].map((key) => pages.find((p) => p.page_key === key && p.language === language) || pages.find((p) => p.page_key === key));
  return <DocsLayout language={language} currentHref={currentHref} communityPages={communityPages}>
    <Typography component="h1" variant="h3" fontWeight={800}>Doc / News Submission</Typography>
    <Typography sx={{
      my: 2,
      lineHeight: 1.8
    }}>{uiPair(language, 'Help build SP-Wiki: edit documentation, share template tutorials or introduce your research. Any signed-in user can submit; administrators review before publication.', '一起建设 SP-Wiki：修改文档、分享模板教程或介绍研究成果。任何登录用户都可以投稿，管理员审核后公开发布。')}</Typography>
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{
      mb: 3
    }}><Button component={RouterLink} to="/docs/doc-news-submission">{uiPair(language, 'Read submission guidelines', '阅读投稿指南')}</Button><Button component={RouterLink} to="/docs">SP-Wiki</Button><Button component={RouterLink} to="/request-template">{uiPair(language, 'Request a survey template', '申请新增问卷模板')}</Button></Stack>
    {loading ? <CircularProgress /> : !user ? <Alert severity="info" action={<Button component={RouterLink} to={`/login?next=${encodeURIComponent('/contribute' + (params.toString() ? '?' + params.toString() : ''))}`}>{uiPair(language, 'Sign in / register', '登录 / 注册')}</Button>}>{uiPair(language, 'Sign in to submit and track your contributions.', '请登录后提交和查看自己的申请。')}</Alert> : <>
      <Stack direction="row" gap={1} sx={{
        mb: 2
      }} flexWrap="wrap">{[['doc_new', uiPair(language, 'New tutorial / doc', '新模板教程 / 文档')], ['doc_edit', uiPair(language, 'Edit a document', '编辑现有文档')], ['news', uiPair(language, 'Research news', '研究新闻')]].map(([kind, label]) => <Button key={kind} variant={form.kind === kind ? 'contained' : 'outlined'} disabled={busy} onClick={() => {
          if (!form.body || window.confirm(uiPair(language, 'Start a new contribution and clear the editor?', '开始新投稿会清空当前编辑框，是否继续？'))) start(kind);
        }}>{label}</Button>)}</Stack>
      {error && <Alert severity="error" sx={{
        mb: 2
      }}>{error}</Alert>}{notice && <Alert severity="success" sx={{
        mb: 2
      }}>{notice}</Alert>}
      <Box component="form" onSubmit={save} sx={{
        p: {
          xs: 2,
          md: 3
        },
        bgcolor: 'background.paper',
        borderRadius: 2,
        border: 1,
        borderColor: 'divider'
      }}>
        <Stack component="fieldset" disabled={busy || form.status === 'approved'} gap={2} sx={{
          border: 0,
          p: 0,
          m: 0,
          minWidth: 0
        }}>
          <TextField select label={uiPair(language, 'Submission language', '投稿语言')} value={form.language} disabled={locked || busy} onChange={(e) => {
            if (!form.body || window.confirm(uiPair(language, 'Change language and clear the editor?', '切换语言会清空当前编辑框，是否继续？'))) {
              setForm(blank(e.target.value, form.kind, form.target_key));
              setSourceReady(false);
            }
          }}><MenuItem value="en">English</MenuItem><MenuItem value="zh">中文</MenuItem></TextField>
          {form.kind === 'doc_edit' && <TextField select required label={uiPair(language, 'Document to edit', '要编辑的文档')} value={form.target_key} disabled={locked || busy} onChange={(e) => {
            if (!form.body || window.confirm(uiPair(language, 'Change document and clear the editor?', '切换文档会清空当前编辑框，是否继续？'))) {
              setForm((f) => ({
                ...blank(f.language, 'doc_edit', e.target.value),
                contributor_name: f.contributor_name
              }));
              setSourceReady(false);
            }
          }}><MenuItem value="">{uiPair(language, 'Choose a document', '请选择')}</MenuItem>{options.map((o) => <MenuItem key={o.key} value={o.key}>{o.title}</MenuItem>)}</TextField>}
          <TextField required label={uiPair(language, 'Public contributor name', '公开署名')} value={form.contributor_name} onChange={(e) => field('contributor_name', e.target.value)} inputProps={{
            minLength: 2,
            maxLength: 100
          }} helperText={uiPair(language, 'Displayed publicly with an approved article.', '审核通过后随文章公开展示。')} />
          <TextField required label={uiPair(language, 'Title', '标题')} value={form.title} onChange={(e) => field('title', e.target.value)} inputProps={{
            minLength: 3,
            maxLength: 200
          }} />
          <TextField label={uiPair(language, 'Summary', '摘要')} value={form.summary} onChange={(e) => field('summary', e.target.value)} multiline minRows={2} inputProps={{
            maxLength: 1000
          }} />
          {form.kind !== 'news' && <TextField select label={uiPair(language, 'Related survey template (optional)', '关联问卷模板（可选）')} value={form.template_id || ''} onChange={(e) => field('template_id', e.target.value)}><MenuItem value="">{uiPair(language, 'None', '无')}</MenuItem>{PAPER_TEMPLATE_DOCS.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}</TextField>}
          <TextField required label={uiPair(language, 'Body (Markdown)', '正文（Markdown）')} value={form.body} onChange={(e) => field('body', e.target.value)} multiline minRows={14} inputProps={{
            minLength: 20,
            maxLength: 80000
          }} helperText={uiPair(language, 'Headings, tables, links and image URLs are supported. The platform provides template previews, live settings and scoring tools. Keep access keys and participant personal data out of the text.', '支持标题、表格、链接和图片链接。模板预览、实时设置和计分组件由平台提供。不要粘贴访问密钥或参与者个人信息。')} />
          <TextField required label={uiPair(language, 'Change / submission rationale (for review)', '修改说明 / 投稿说明（仅审核可见）')} value={form.change_reason} onChange={(e) => field('change_reason', e.target.value)} multiline minRows={2} inputProps={{
            minLength: 10,
            maxLength: 2000
          }} />
          <TextField label={uiPair(language, 'Sources and media permissions (for review)', '来源与素材授权说明（仅审核可见）')} value={form.source_notes} onChange={(e) => field('source_notes', e.target.value)} multiline minRows={2} inputProps={{
            maxLength: 5000
          }} helperText={uiPair(language, 'Include reader-facing references and DOIs in the article too. Use public image URLs you have permission to share.', '正文中也应保留读者需要的引用和 DOI。图片请使用可公开访问、获授权的链接。')} />
          <FormControlLabel control={<Checkbox required checked={!!form.rights_confirmed} onChange={(e) => field('rights_confirmed', e.target.checked)} />} label={uiPair(language, 'I have permission to contribute this text and media and agree to publication under the name above after review.', '我确认有权提交这些文字和素材，并同意审核通过后以所填署名公开发布。')} />
          <Stack direction="row" gap={1} flexWrap="wrap"><Button type="submit" variant="contained" disabled={busy || form.status === 'approved' || form.kind === 'doc_edit' && !sourceReady && !locked}>{busy ? uiPair(language, 'Working…', '处理中…') : uiPair(language, 'Submit for review', '提交审核')}</Button><Button onClick={() => setPreview((v) => !v)}>{uiPair(language, 'Preview article', '预览正文')}</Button>{form.kind === 'doc_edit' && <Button disabled={busy || !form.target_key} onClick={rebase}>{uiPair(language, 'Load latest source to merge', '载入最新原文以合并修改')}</Button>}</Stack>
          {preview && <Box sx={{
            p: 2,
            border: 1,
            borderColor: 'divider'
          }}><Typography variant="h5">{form.title}</Typography><Typography color="text.secondary">{form.summary}</Typography><WikiMarkdown body={form.body} /></Box>}
          {form.kind === 'doc_edit' && form.base_content?.body && <Box component="details"><summary>{zh ? `查看原文 · 社区版本 ${form.base_revision}` : `View source · Community revision ${form.base_revision}`}</summary><WikiMarkdown body={form.base_content.body} /></Box>}
        </Stack>
      </Box>
      <Typography component="h2" variant="h5" fontWeight={700} sx={{
        mt: 5,
        mb: 2
      }}>{uiPair(language, 'My submissions', '我的投稿')}</Typography><Button onClick={refresh}>{uiPair(language, 'Refresh status', '刷新状态')}</Button>
      {listError && <Alert severity="warning">{listError}</Alert>}{!rows.length && !listError && <Typography>{uiPair(language, 'No submissions yet.', '还没有投稿。')}</Typography>}
      {rows.map((row) => <Box key={row.id} sx={{
        p: 2,
        my: 2,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2
      }}><Typography fontWeight={700}>{row.title}</Typography><Typography variant="body2" color="text.secondary">{submissionStatus(row.status, zh)} · {row.language.toUpperCase()} · {new Date(row.updated_at).toLocaleString()}</Typography>{row.review_note && <Alert severity={row.status === 'approved' ? 'success' : 'info'} sx={{
          mt: 1
        }}>{row.review_note}</Alert>}{row.published_url ? <Button component={RouterLink} to={row.published_url}>{uiPair(language, 'View published article', '查看已发布文章')}</Button> : <Button disabled={busy} onClick={() => {
          if (!form.body || form.id === row.id || window.confirm(uiPair(language, 'Open this submission and replace the editor?', '打开此申请会替换当前编辑框，是否继续？'))) {
            setForm({
              ...row,
              template_id: row.template_id || ''
            });
            setSourceReady(true);
            setError('');
            setNotice('');
            window.scrollTo(0, 0);
          }
        }}>{uiPair(language, 'Open / revise and resubmit', '打开 / 修改后重投')}</Button>}</Box>)}
    </>}
  </DocsLayout>;
}