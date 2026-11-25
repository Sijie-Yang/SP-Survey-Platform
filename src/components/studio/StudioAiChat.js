import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, LinearProgress, TextField, Typography } from '@mui/material';
import { AutoAwesome, Send, Undo } from '@mui/icons-material';
import { generateSpSchemePage } from '../../lib/agentApi';
import { readSpSchemeUpload } from '../../lib/spScheme';
import { prepareSpSchemeUpload } from '../../lib/spSchemeImport';
import { importIntoStudio } from '../../lib/studioImport';
import { StudioCard, useL } from './studioUi';

const STORE_PREFIX = 'sp-studio-ai-chat:';
const MAX_STORED_MESSAGES = 40;
const HISTORY_TURNS = 10;

function storeKey(projectId) {
  return `${STORE_PREFIX}${projectId}`;
}

export function readStudioAiChat(projectId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storeKey(projectId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStudioAiChat(projectId, messages) {
  // Only the newest saved change keeps the page it replaced (for 撤销).
  let undoKept = false;
  const trimmed = messages.slice(-MAX_STORED_MESSAGES).reverse().map((m) => {
    if (!m.undoHtml) return m;
    if (undoKept) return { ...m, undoHtml: undefined };
    undoKept = true;
    return m;
  }).reverse();
  try {
    window.localStorage.setItem(storeKey(projectId), JSON.stringify(trimmed));
  } catch {
    // Storage full or blocked: the chat still works, it is just not remembered.
  }
  return trimmed;
}

/** The checked upload for a page the AI wrote (same check as a dropped file). */
export function preparePage(html) {
  return prepareSpSchemeUpload(readSpSchemeUpload(new TextEncoder().encode(String(html || ''))), { name: 'index.html' });
}

function modelText(result, L) {
  if (!result?.model) return '';
  return result.shared ? L(`${result.model} (free)`, `${result.model}（免费）`) : result.model;
}

function failText(result, L) {
  if (result?.code === 'CREDENTIALS_MISSING') {
    return L(
      'No AI model is available right now. Add your own model in AI & Integrations, or copy the instructions for your own AI.',
      '现在没有可用的 AI 模型。可以在“AI 与集成”里添加自己的模型，或者复制说明交给你自己的 AI。',
    );
  }
  return L(`Something went wrong: ${result?.error || 'unknown error'}. Try again.`, `出错了：${result?.error || '未知错误'}。请再试一次。`);
}

function Bubble({ message, canUndo, onUndo, disabled }) {
  const L = useL();
  const mine = message.role === 'user';
  return (
    <Box sx={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <Box
        data-testid={mine ? 'studio-ai-user' : 'studio-ai-reply'}
        sx={{
          maxWidth: '92%',
          px: 1.5,
          py: 1,
          borderRadius: '12px',
          bgcolor: mine ? 'primary.main' : 'action.hover',
          color: mine ? 'primary.contrastText' : 'text.primary',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        <Typography variant="body2" component="div">{message.text}</Typography>
        {message.status === 'saved' && (
          <Typography variant="caption" component="div" sx={{ mt: 0.5, color: 'success.main', fontWeight: 600 }}>
            {L('Saved. The preview shows the new page.', '已保存，预览已更新。')}
          </Typography>
        )}
        {message.status === 'undone' && (
          <Typography variant="caption" component="div" sx={{ mt: 0.5, color: 'text.secondary' }}>
            {L('Undone: the page before this change is back.', '已撤销，恢复到这次修改之前的页面。')}
          </Typography>
        )}
        {message.status === 'problems' && (
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption" component="div" sx={{ color: 'error.main', fontWeight: 600 }}>
              {L('Not saved: the page still has problems. Ask the AI to fix them.', '没有保存：页面还有问题，可以让 AI 再改。')}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {(message.problems || []).slice(0, 5).map((p, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <Typography component="li" variant="caption" key={i}>{p.message}</Typography>
              ))}
            </Box>
          </Box>
        )}
        {message.status === 'error' && (
          <Typography variant="caption" component="div" sx={{ mt: 0.5, color: 'error.main' }}>{message.error}</Typography>
        )}
        {message.model && (
          <Typography variant="caption" component="div" sx={{ mt: 0.5, color: 'text.secondary' }}>{message.model}</Typography>
        )}
        {canUndo && (
          <Button size="small" startIcon={<Undo />} onClick={onUndo} disabled={disabled} sx={{ mt: 0.5, ml: -0.75 }}>
            {L('Undo this change', '撤销这次修改')}
          </Button>
        )}
      </Box>
    </Box>
  );
}

/**
 * Studio's AI assistant for an SP-Scheme study: a chat that writes and changes
 * the page. Each page the AI sends goes through the same check as a dropped
 * file and is saved only when it passes; the newest change can be undone.
 */
export default function StudioAiChat({ project, config, runImport, busy = false, userId = null, onSaved = () => {} }) {
  const L = useL();
  const projectId = project?.id;
  const [messages, setMessages] = useState(() => readStudioAiChat(projectId));
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const listRef = useRef(null);
  const currentHtml = config?.spSite?.html || '';
  const empty = !currentHtml;

  useEffect(() => { setMessages(readStudioAiChat(projectId)); }, [projectId]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  const save = (next) => setMessages(writeStudioAiChat(projectId, next));

  const applyPage = async (html) => {
    const prepared = preparePage(html);
    if (!prepared.report?.ok || prepared.upload?.asIs) return { ok: false, prepared };
    const result = await runImport(() => importIntoStudio({ prepared, project, userId, fallbackName: project?.name }));
    return { ok: Boolean(result), prepared };
  };

  const send = async () => {
    const request = text.trim();
    if (!request || running || busy) return;
    const history = messages.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, text: m.text }));
    let next = [...messages, { role: 'user', text: request }];
    save(next);
    setText('');
    setRunning(true);
    try {
      const result = await generateSpSchemePage({ request, history, ...(currentHtml ? { currentHtml } : {}) });
      const model = modelText(result, L);
      if (!result?.success) {
        next = [...next, { role: 'assistant', text: L('I could not do that.', '这次没能完成。'), status: 'error', error: failText(result, L) }];
      } else if (!result.html) {
        next = [...next, { role: 'assistant', text: result.reply || L('(no answer)', '（没有回答）'), status: 'answer', model }];
      } else {
        const reply = result.reply || (empty ? L('Here is the survey page.', '问卷页面做好了。') : L('Changed the page.', '页面改好了。'));
        const applied = await applyPage(result.html);
        next = applied.ok
          ? [...next, { role: 'assistant', text: reply, status: 'saved', model, undoHtml: currentHtml || null }]
          : [...next, { role: 'assistant', text: reply, status: 'problems', model, problems: result.check?.problems?.length ? result.check.problems : [{ message: L('The page did not pass the check.', '页面没有通过检查。') }] }];
        if (applied.ok) onSaved();
      }
    } catch (err) {
      next = [...next, { role: 'assistant', text: L('I could not do that.', '这次没能完成。'), status: 'error', error: failText({ error: err?.message || String(err) }, L) }];
    } finally {
      save(next);
      setRunning(false);
    }
  };

  const lastSaved = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].status === 'saved') return i;
    }
    return -1;
  })();
  const canUndoAt = (i) => i === lastSaved && Boolean(messages[i].undoHtml);

  const undo = async (i) => {
    const target = messages[i];
    if (!target?.undoHtml || running || busy) return;
    setRunning(true);
    try {
      const applied = await applyPage(target.undoHtml);
      if (applied.ok) {
        save(messages.map((m, k) => (k === i ? { ...m, status: 'undone', undoHtml: undefined } : m)));
        onSaved();
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <StudioCard
      title={(
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <AutoAwesome color="primary" sx={{ fontSize: 20 }} />
          {L('AI assistant', 'AI 助手')}
        </Box>
      )}
      data-testid="studio-ai-chat"
    >
      {messages.length > 0 ? (
        <Box
          ref={listRef}
          data-testid="studio-ai-messages"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 380, overflowY: 'auto', mb: 1.5, pr: 0.5 }}
        >
          {messages.map((m, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Bubble key={i} message={m} canUndo={canUndoAt(i)} onUndo={() => undo(i)} disabled={running || busy} />
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {empty
            ? L('Describe your study, or paste an existing survey. The AI writes the page and the platform checks it before saving.', '描述你的研究，或者贴上已有问卷。AI 写好页面，平台检查通过后自动保存。')
            : L('Tell the AI what to change, one thing at a time. Every change is checked before it is saved, and the last one can be undone.', '告诉 AI 要改什么，一次说一件事。每次修改都会先检查再保存，最近一次可以撤销。')}
        </Typography>
      )}

      {running && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
            {L('The AI is working and the platform is checking its page. This usually takes 1–3 minutes.', 'AI 正在写，平台会自动检查并让它修正，通常需要 1–3 分钟。')}
          </Typography>
          <LinearProgress />
        </Box>
      )}

      <TextField
        multiline
        minRows={2}
        maxRows={8}
        fullWidth
        size="small"
        value={text}
        disabled={running}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
        inputProps={{ 'aria-label': L('Message to the AI', '发给 AI 的消息'), maxLength: 20000 }}
        placeholder={empty
          ? L('For example: participants compare two street photos and pick the safer one for cycling, 20 pairs.', '例如：参与者两两比较街景照片，选出骑车更安全的一张，做 20 组。')
          : L('For example: add a question about age; make the buttons larger.', '例如：加一道年龄题；按钮再大一点。')}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 1 }}>
        <Typography variant="caption" color="text.secondary">{L('Ctrl+Enter to send', 'Ctrl+Enter 发送')}</Typography>
        <Button variant="contained" size="small" endIcon={<Send />} onClick={send} disabled={running || busy || !text.trim()}>
          {L('Send', '发送')}
        </Button>
      </Box>
    </StudioCard>
  );
}
