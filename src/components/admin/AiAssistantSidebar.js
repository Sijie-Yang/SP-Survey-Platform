import React, { useState } from 'react';
import {
  Box,
  Drawer,
  IconButton,
  Typography,
  Tooltip,
  Button,
  Chip,
} from '@mui/material';
import ConfirmDialog from '../layout/ConfirmDialog';
import {
  Close,
  Settings,
  Clear,
  Download,
  SmartToy,
  CheckCircle,
} from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import ChatAssistant from './ChatAssistant';
import { chatPropsFromAssistant } from '../../hooks/useSurveyAssistant';
import { AI_SIDEBAR_ID, AI_SIDEBAR_WIDTH } from '../../hooks/surveyAssistantUtils';

export default function AiAssistantSidebar({
  open,
  onClose,
  assistant,
  onOpenSilicon,
  variant = 'persistent',
  width = AI_SIDEBAR_WIDTH,
}) {
  const { t } = useRegion();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const chatProps = chatPropsFromAssistant(assistant);

  return (
    <Drawer
      id={AI_SIDEBAR_ID}
      anchor="right"
      open={open}
      onClose={onClose}
      variant={variant}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: variant === 'persistent' && open ? width : 0,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          top: variant === 'persistent' ? '64px' : 0,
          height: variant === 'persistent' ? 'calc(100vh - 64px)' : '100%',
          borderLeft: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <SmartToy color="primary" />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {t.aiSidebarTitle}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {assistant?.currentProject?.name || t.aiSidebarSubtitle}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {assistant?.apiKeyValid ? (
            <Chip
              size="small"
              icon={<CheckCircle />}
              label={t.aiSidebarConnected}
              color="success"
              sx={{ mr: 0.5, display: { xs: 'none', sm: 'inline-flex' } }}
            />
          ) : (
            <Chip
              size="small"
              label={t.aiSidebarDisconnected}
              sx={{ mr: 0.5, display: { xs: 'none', sm: 'inline-flex' } }}
            />
          )}
          {chatProps.messages?.length > 0 && (
            <>
              <Tooltip title={t.aiSidebarDownload}>
                <IconButton size="small" onClick={chatProps.onDownloadHistory} aria-label={t.aiSidebarDownload}>
                  <Download fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t.aiSidebarClear}>
                <IconButton size="small" onClick={() => setConfirmClear(true)} aria-label={t.aiSidebarClear}>
                  <Clear fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
          {onOpenSilicon && (
            <Tooltip title={t.aiSidebarSilicon}>
              <Button size="small" onClick={onOpenSilicon} sx={{ textTransform: 'none', minWidth: 0 }}>
                Silicon
              </Button>
            </Tooltip>
          )}
          <Tooltip title={t.aiSidebarSettings}>
            <IconButton
              size="small"
              onClick={() => setSettingsOpen(true)}
              aria-label={t.aiSidebarSettings}
            >
              <Settings fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t.aiSidebarClose}>
            <IconButton size="small" onClick={onClose} aria-label={t.aiSidebarClose}>
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ChatAssistant
          variant="content"
          fillHeight
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          onOpenSilicon={onOpenSilicon}
          {...chatProps}
        />
      </Box>
      <ConfirmDialog
        open={confirmClear}
        title={t.aiClearHistoryTitle}
        message={t.aiClearHistoryMessage}
        confirmLabel={t.aiClearHistoryConfirm}
        confirmColor="error"
        onConfirm={() => {
          setConfirmClear(false);
          chatProps.onClearHistory?.();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </Drawer>
  );
}
