import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, InputAdornment, Menu, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import {
  Add, ArrowBack, ChatBubbleOutline, Lock, LockOpen, MoreVert, PushPin, Search, VisibilityOff,
} from '@mui/icons-material';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import WikiMarkdown from '../components/docs/WikiMarkdown';
import { useAuth } from '../contexts/AuthContext';
import { useRegion } from '../contexts/RegionContext';
import { intlLocale, uiPair } from '../lib/uiLanguages';
import {
  FORUM_BODY_MAX, FORUM_CATEGORIES, FORUM_NAME_MAX, FORUM_TITLE_MAX, createForumThread, editForumItem, getForumThread,
  isForumAdmin, listForumThreads, moderateForumItem, readDisplayName, replyToForumThread, saveDisplayName,
} from '../lib/forumStore';

const CATEGORY_LABELS = {
  announcements: ['Announcements', '公告'],
  general: ['General', '综合讨论'],
  help: ['Help', '求助'],
  methods: ['Methods', '研究方法'],
  showcase: ['Showcase', '成果展示'],
  ideas: ['Ideas', '功能建议'],
};

export function relativeTime(iso, language, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((t - now) / 1000);
  const fmt = new Intl.RelativeTimeFormat(intlLocale(language), { numeric: 'auto' });
  const steps = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [86400 * 30, 'day', 86400]];
  if (Math.abs(s) < 60) return fmt.format(0, 'second');
  for (const [limit, unit, div] of steps.slice(1)) {
    if (Math.abs(s) < limit) return fmt.format(Math.round(s / div), unit);
  }
  return new Date(t).toLocaleDateString(intlLocale(language), { year: 'numeric', month: 'short', day: 'numeric' });
}

function CategoryChip({ category, L, ...rest }) {
  const [en, zh] = CATEGORY_LABELS[category] || CATEGORY_LABELS.general;
  return <Chip size="small" variant="outlined" label={L(en, zh)} {...rest} />;
}

function signInPath(path) {
  return `/login?next=${encodeURIComponent(path)}`;
}

function errorText(err, L) {
  if (err?.missingTable) return L('The forum is not switched on yet. (Admins: run supabase/forum.sql once.)', '论坛还没有开通。（管理员：在 Supabase 运行一次 supabase/forum.sql。）');
  if (err?.rateLimited) return L('You are posting quickly; please wait a little and try again.', '发得有点快，请稍等一会儿再试。');
  if (err?.closed) return L('This thread is closed.', '这个帖子已关闭。');
  return err?.message || String(err);
}

function DisplayNameField({ value, onChange, L }) {
  return (
    <TextField size="small" label={L('Display name (optional)', '显示名称（可选）')} value={value}
      onChange={(e) => onChange(e.target.value.slice(0, FORUM_NAME_MAX))}
      helperText={L('Shown with your post. Your e-mail is never shown.', '显示在帖子旁边。不会显示你的邮箱。')}
      sx={{ maxWidth: 320 }} />
  );
}

// ---------------------------------------------------------------- list

function NewThreadDialog({ open, onClose, onCreated, isAdmin, L }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [name, setName] = useState(readDisplayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const canSend = title.trim().length >= 3 && body.trim().length >= 1 && !busy;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createForumThread({ title, body, category, authorName: name });
      saveDisplayName(name);
      setTitle('');
      setBody('');
      onCreated(id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{L('New thread', '发新帖')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={L('Title', '标题')} value={title} onChange={(e) => setTitle(e.target.value.slice(0, FORUM_TITLE_MAX))} autoFocus required />
          <TextField select label={L('Category', '分类')} value={category} onChange={(e) => setCategory(e.target.value)} sx={{ maxWidth: 240 }}>
            {FORUM_CATEGORIES.filter((c) => c !== 'announcements' || isAdmin).map((c) => (
              <MenuItem key={c} value={c}>{L(...CATEGORY_LABELS[c])}</MenuItem>
            ))}
          </TextField>
          <TextField label={L('Post', '正文')} value={body} onChange={(e) => setBody(e.target.value.slice(0, FORUM_BODY_MAX))} multiline minRows={8} required
            helperText={L('Markdown works: **bold**, lists, links, `code`. Never paste participant data or API keys.', '支持 Markdown：**加粗**、列表、链接、`代码`。不要贴参与者数据或 API key。')} />
          <DisplayNameField value={name} onChange={setName} L={L} />
          {error && <Alert severity="error">{errorText(error, L)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{L('Cancel', '取消')}</Button>
        <Button variant="contained" onClick={submit} disabled={!canSend}>{busy ? L('Posting…', '发布中…') : L('Post', '发布')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function ThreadRow({ thread, language, L }) {
  return (
    <Paper component={RouterLink} to={`/forum/${thread.id}`} variant="outlined" data-testid="forum-thread-row" sx={{
      display: 'block', textDecoration: 'none', color: 'inherit', p: { xs: 1.5, sm: 2 },
      opacity: thread.hidden ? 0.55 : 1,
      '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
    }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 0.5 }}>
            {thread.pinned && <PushPin fontSize="small" color="primary" titleAccess={L('Pinned', '置顶')} />}
            {thread.status === 'closed' && <Lock fontSize="small" color="action" titleAccess={L('Closed', '已关闭')} />}
            {thread.hidden && <VisibilityOff fontSize="small" color="action" titleAccess={L('Hidden', '已隐藏')} />}
            <Typography variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{thread.title}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <CategoryChip category={thread.category} L={L} />
            <Typography variant="caption" color="text.secondary">
              {thread.authorName} · {relativeTime(thread.lastActivityAt, language)}
            </Typography>
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary', flexShrink: 0, pt: 0.5 }}>
          <ChatBubbleOutline sx={{ fontSize: 16 }} />
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{thread.replyCount}</Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

function ForumList({ L, language, user, isAdmin }) {
  const navigate = useNavigate();
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [threads, setThreads] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listForumThreads({ category, status, search, page }).then((res) => {
      if (cancelled) return;
      setThreads((prev) => (page ? [...prev, ...res.threads] : res.threads));
      setHasMore(res.hasMore);
    }).catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category, status, search, page]);

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} sx={{ mb: 3 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>SP-Forum</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            {L('Ask questions, discuss methods and share studies with other perception researchers.', '提问、讨论研究方法、分享研究，和其他感知研究者交流。')}
          </Typography>
        </Box>
        {user
          ? <Button variant="contained" startIcon={<Add />} onClick={() => setComposing(true)}>{L('New thread', '发新帖')}</Button>
          : <Button variant="outlined" component={RouterLink} to={signInPath('/forum')}>{L('Sign in to post', '登录后发帖')}</Button>}
      </Stack>

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
        <Chip label={L('All', '全部')} color={category ? 'default' : 'primary'} variant={category ? 'outlined' : 'filled'} onClick={() => { setPage(0); setCategory(''); }} />
        {FORUM_CATEGORIES.map((c) => (
          <Chip key={c} label={L(...CATEGORY_LABELS[c])} color={category === c ? 'primary' : 'default'} variant={category === c ? 'filled' : 'outlined'}
            onClick={() => { setPage(0); setCategory(c); }} />
        ))}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField size="small" placeholder={L('Search threads', '搜索帖子')} value={query} onChange={(e) => { setPage(0); setQuery(e.target.value); }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={status} onChange={(_, v) => { if (v) { setPage(0); setStatus(v); } }}>
          <ToggleButton value="all">{L('All', '全部')}</ToggleButton>
          <ToggleButton value="open">{L('Open', '进行中')}</ToggleButton>
          <ToggleButton value="closed">{L('Closed', '已关闭')}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {error && <Alert severity={error.missingTable ? 'info' : 'error'} sx={{ mb: 2 }}>{errorText(error, L)}</Alert>}
      {!error && !loading && threads.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
          {search || category || status !== 'all' ? L('No threads match.', '没有符合条件的帖子。') : L('No threads yet. Start the first one!', '还没有帖子，来发第一帖吧！')}
        </Typography>
      )}
      <Stack spacing={1.25}>
        {threads.map((t) => <ThreadRow key={t.id} thread={t} language={language} L={L} />)}
      </Stack>
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>}
      {!loading && hasMore && (
        <Box sx={{ textAlign: 'center', mt: 2 }}><Button onClick={() => setPage((p) => p + 1)}>{L('Load more', '加载更多')}</Button></Box>
      )}

      <NewThreadDialog open={composing} isAdmin={isAdmin} L={L} onClose={() => setComposing(false)}
        onCreated={(id) => { setComposing(false); navigate(`/forum/${id}`); }} />
    </>
  );
}

// ---------------------------------------------------------------- thread

function ItemMenu({ actions, L }) {
  const [anchor, setAnchor] = useState(null);
  if (!actions.length) return null;
  return (
    <>
      <IconButton size="small" aria-label={L('More actions', '更多操作')} onClick={(e) => setAnchor(e.currentTarget)}><MoreVert fontSize="small" /></IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {actions.map((a) => (
          <MenuItem key={a.key} onClick={() => { setAnchor(null); a.run(); }} sx={a.danger ? { color: 'error.main' } : undefined}>{a.label}</MenuItem>
        ))}
      </Menu>
    </>
  );
}

function EditBox({ initialBody, initialTitle = null, onSave, onCancel, L }) {
  const [body, setBody] = useState(initialBody);
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ body, title });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Stack spacing={1.5}>
      {initialTitle != null && <TextField label={L('Title', '标题')} value={title} onChange={(e) => setTitle(e.target.value.slice(0, FORUM_TITLE_MAX))} />}
      <TextField multiline minRows={5} value={body} onChange={(e) => setBody(e.target.value.slice(0, FORUM_BODY_MAX))} />
      {error && <Alert severity="error">{errorText(error, L)}</Alert>}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" size="small" onClick={save} disabled={busy || !body.trim()}>{L('Save', '保存')}</Button>
        <Button size="small" onClick={onCancel} disabled={busy}>{L('Cancel', '取消')}</Button>
      </Stack>
    </Stack>
  );
}

function PostMeta({ name, createdAt, editedAt, language, L, isOp }) {
  return (
    <Typography variant="caption" color="text.secondary">
      <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{name}</Box>
      {isOp && <Box component="span" sx={{ ml: 0.75 }}>· {L('author', '楼主')}</Box>}
      {' · '}{relativeTime(createdAt, language)}
      {editedAt && ` · ${L('edited', '已编辑')}`}
    </Typography>
  );
}

function ForumThread({ id, L, language, user, isAdmin }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [reply, setReply] = useState('');
  const [name, setName] = useState(readDisplayName);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await getForumThread(id));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const run = (fn) => async () => {
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(err);
    }
  };

  const thread = data?.thread;
  const mine = (authorId) => !!user && authorId === user.id;
  const canManage = thread && (mine(thread.authorId) || isAdmin);
  const canReply = !!user && thread && (thread.status === 'open' || isAdmin);

  const threadActions = useMemo(() => {
    if (!thread) return [];
    const list = [];
    if (canManage) {
      list.push({ key: 'edit', label: L('Edit', '编辑'), run: () => setEditing('thread') });
      list.push(thread.status === 'open'
        ? { key: 'close', label: L('Close thread', '关闭帖子'), run: run(() => moderateForumItem('thread', thread.id, 'close')) }
        : { key: 'reopen', label: L('Reopen thread', '重新打开'), run: run(() => moderateForumItem('thread', thread.id, 'reopen')) });
    }
    if (isAdmin) {
      list.push(thread.pinned
        ? { key: 'unpin', label: L('Unpin', '取消置顶'), run: run(() => moderateForumItem('thread', thread.id, 'unpin')) }
        : { key: 'pin', label: L('Pin to top', '置顶'), run: run(() => moderateForumItem('thread', thread.id, 'pin')) });
      list.push(thread.hidden
        ? { key: 'restore', label: L('Restore', '恢复显示'), run: run(() => moderateForumItem('thread', thread.id, 'restore')) }
        : { key: 'hide', label: L('Hide (moderation)', '隐藏（管理）'), danger: true, run: run(() => moderateForumItem('thread', thread.id, 'hide')) });
    } else if (mine(thread.authorId)) {
      list.push({
        key: 'delete', label: L('Delete thread', '删除帖子'), danger: true,
        run: run(async () => {
          // eslint-disable-next-line no-alert
          if (!window.confirm(L('Delete this thread and hide all replies?', '删除这个帖子（回复也会一起隐藏）？'))) return;
          await moderateForumItem('thread', thread.id, 'delete');
          navigate('/forum');
        }),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, canManage, isAdmin, user]);

  const postActions = (post) => {
    const list = [];
    if (mine(post.authorId) || isAdmin) list.push({ key: 'edit', label: L('Edit', '编辑'), run: () => setEditing(post.id) });
    if (isAdmin) {
      list.push(post.hidden
        ? { key: 'restore', label: L('Restore', '恢复显示'), run: run(() => moderateForumItem('post', post.id, 'restore')) }
        : { key: 'hide', label: L('Hide (moderation)', '隐藏（管理）'), danger: true, run: run(() => moderateForumItem('post', post.id, 'hide')) });
    } else if (mine(post.authorId)) {
      list.push({ key: 'delete', label: L('Delete', '删除'), danger: true, run: run(() => moderateForumItem('post', post.id, 'delete')) });
    }
    return list;
  };

  const sendReply = async () => {
    setSending(true);
    setActionError(null);
    try {
      await replyToForumThread(id, { body: reply, authorName: name });
      saveDisplayName(name);
      setReply('');
      await load();
    } catch (err) {
      setActionError(err);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;

  return (
    <>
      <Button startIcon={<ArrowBack />} component={RouterLink} to="/forum" sx={{ mb: 2 }}>{L('All threads', '全部帖子')}</Button>
      {error && <Alert severity={error.missingTable ? 'info' : 'error'}>{errorText(error, L)}</Alert>}
      {!error && !thread && <Alert severity="info">{L('This thread does not exist or was removed.', '这个帖子不存在或已被删除。')}</Alert>}
      {thread && (
        <>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 2 }} data-testid="forum-thread">
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                  <CategoryChip category={thread.category} L={L} />
                  {thread.pinned && <Chip size="small" icon={<PushPin />} label={L('Pinned', '置顶')} />}
                  {thread.status === 'closed'
                    ? <Chip size="small" icon={<Lock />} label={L('Closed', '已关闭')} />
                    : <Chip size="small" icon={<LockOpen />} color="success" variant="outlined" label={L('Open', '进行中')} />}
                  {thread.hidden && <Chip size="small" icon={<VisibilityOff />} label={L('Hidden', '已隐藏')} />}
                </Stack>
                {editing !== 'thread' && (
                  <Typography variant="h5" component="h1" fontWeight={800} sx={{ mb: 1, overflowWrap: 'anywhere' }}>{thread.title}</Typography>
                )}
                <PostMeta name={thread.authorName} createdAt={thread.createdAt} editedAt={thread.editedAt} language={language} L={L} />
              </Box>
              <ItemMenu actions={threadActions} L={L} />
            </Stack>
            <Box sx={{ mt: 2 }}>
              {editing === 'thread'
                ? <EditBox initialBody={thread.body} initialTitle={thread.title} L={L} onCancel={() => setEditing(null)}
                    onSave={async ({ body, title }) => { await editForumItem('thread', thread.id, { body, title }); setEditing(null); await load(); }} />
                : <WikiMarkdown body={thread.body} allowImages={false} />}
            </Box>
          </Paper>

          {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{errorText(actionError, L)}</Alert>}

          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {L(`${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}`, `${thread.replyCount} 条回复`)}
          </Typography>
          <Stack spacing={1.25} sx={{ mb: 3 }}>
            {data.posts.map((post, i) => (
              <Paper key={post.id} variant="outlined" data-testid="forum-post" sx={{ p: { xs: 1.5, sm: 2 }, opacity: post.hidden ? 0.55 : 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>#{i + 1}</Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <PostMeta name={post.authorName} createdAt={post.createdAt} editedAt={post.editedAt} language={language} L={L}
                      isOp={!!post.authorId && post.authorId === thread.authorId} />
                    {post.hidden && <Typography variant="caption" color="text.secondary"> · {L('hidden', '已隐藏')}</Typography>}
                  </Box>
                  <ItemMenu actions={postActions(post)} L={L} />
                </Stack>
                <Box sx={{ mt: 1 }}>
                  {editing === post.id
                    ? <EditBox initialBody={post.body} L={L} onCancel={() => setEditing(null)}
                        onSave={async ({ body }) => { await editForumItem('post', post.id, { body }); setEditing(null); await load(); }} />
                    : <WikiMarkdown body={post.body} allowImages={false} />}
                </Box>
              </Paper>
            ))}
          </Stack>

          <Divider sx={{ mb: 2 }} />
          {!user && (
            <Alert severity="info" action={<Button component={RouterLink} to={signInPath(`/forum/${thread.id}`)}>{L('Sign in', '登录')}</Button>}>
              {L('Sign in to reply.', '登录后即可回复。')}
            </Alert>
          )}
          {user && thread.status === 'closed' && !isAdmin && (
            <Alert severity="info" icon={<Lock />}>{L('This thread is closed. Start a new thread to continue the discussion.', '这个帖子已关闭。如需继续讨论，请发新帖。')}</Alert>
          )}
          {canReply && (
            <Stack spacing={1.5} data-testid="forum-reply-box">
              <TextField label={L('Your reply', '你的回复')} value={reply} onChange={(e) => setReply(e.target.value.slice(0, FORUM_BODY_MAX))} multiline minRows={4}
                helperText={L('Markdown works. Be kind; no participant data or API keys.', '支持 Markdown。友善交流；不要贴参与者数据或 API key。')} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
                <DisplayNameField value={name} onChange={setName} L={L} />
                <Box sx={{ flex: 1 }} />
                <Button variant="contained" onClick={sendReply} disabled={sending || !reply.trim()}>{sending ? L('Sending…', '发送中…') : L('Reply', '回复')}</Button>
              </Stack>
            </Stack>
          )}
        </>
      )}
    </>
  );
}

export default function ForumPage() {
  const { id } = useParams();
  const { language } = useRegion();
  const { user } = useAuth();
  const L = (en, zh) => uiPair(language, en, zh);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setIsAdmin(false); return undefined; }
    isForumAdmin().then((v) => { if (!cancelled) setIsAdmin(v); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    document.title = 'SP-Forum · SP-Survey';
  }, []);

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <PublicHeader />
      <Container maxWidth="md" sx={{ py: { xs: 3, sm: 5 }, flex: 1 }}>
        {id
          ? <ForumThread id={id} L={L} language={language} user={user} isAdmin={isAdmin} />
          : <ForumList L={L} language={language} user={user} isAdmin={isAdmin} />}
      </Container>
      <PublicFooter />
    </Box>
  );
}
