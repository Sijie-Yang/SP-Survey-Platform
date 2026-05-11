import React, { useState } from 'react';
import {
  Box,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Popover,
  Paper,
  Divider,
  Chip,
} from '@mui/material';
import { useRegion, REGIONS, LANGUAGES } from '../../contexts/RegionContext';

export default function RegionSwitcher() {
  const { region, setRegion, language, setLanguage, isChinaMode } = useRegion();
  const [anchorEl, setAnchorEl] = useState(null);

  const handleOpen = (e) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleRegion = (_, newRegion) => {
    if (newRegion) {
      setRegion(newRegion);
      handleClose();
    }
  };

  const handleLanguage = (_, newLang) => {
    if (newLang) setLanguage(newLang);
  };

  return (
    <>
      <Tooltip title={isChinaMode ? '中国区模式已启用' : 'Switch to China Mode'}>
        <Box
          onClick={handleOpen}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            cursor: 'pointer',
            px: 1.2,
            py: 0.5,
            borderRadius: '16px',
            border: '1px solid',
            borderColor: isChinaMode ? 'rgba(255,80,80,0.6)' : 'rgba(255,255,255,0.35)',
            bgcolor: isChinaMode ? 'rgba(255,80,80,0.18)' : 'rgba(255,255,255,0.08)',
            transition: 'all 0.25s',
            '&:hover': {
              bgcolor: isChinaMode ? 'rgba(255,80,80,0.28)' : 'rgba(255,255,255,0.15)',
              borderColor: isChinaMode ? 'rgba(255,80,80,0.8)' : 'rgba(255,255,255,0.6)',
            },
          }}
        >
          <Typography variant="body2" sx={{ fontSize: '1rem', lineHeight: 1 }}>
            {isChinaMode ? '🇨🇳' : '🌍'}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              fontSize: '0.75rem',
              color: 'inherit',
              display: { xs: 'none', sm: 'block' },
            }}
          >
            {isChinaMode ? '中国区' : 'Global'}
          </Typography>
        </Box>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { mt: 1, borderRadius: 2, minWidth: 260 } }}
      >
        <Paper elevation={0} sx={{ p: 2 }}>
          {/* Region selector */}
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
            🌐 REGION / 区域
          </Typography>
          <ToggleButtonGroup
            value={region}
            exclusive
            onChange={handleRegion}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          >
            <ToggleButton value={REGIONS.GLOBAL} sx={{ flex: 1, textTransform: 'none', fontWeight: 600 }}>
              🌍 Global
            </ToggleButton>
            <ToggleButton value={REGIONS.CHINA} sx={{ flex: 1, textTransform: 'none', fontWeight: 600 }}>
              🇨🇳 中国
            </ToggleButton>
          </ToggleButtonGroup>

          {/* Service stack info */}
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: isChinaMode ? 'rgba(255,80,80,0.06)' : 'rgba(25,118,210,0.05)',
              border: '1px solid',
              borderColor: isChinaMode ? 'rgba(255,80,80,0.2)' : 'rgba(25,118,210,0.15)',
              mb: 2,
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
              {isChinaMode ? '中国区服务栈' : 'Global Service Stack'}
            </Typography>
            {isChinaMode ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                <Chip label="🖼  ModelScope（魔搭）" size="small" sx={{ justifyContent: 'flex-start', fontSize: '0.72rem' }} />
                <Chip label="☁️  阿里云 OSS" size="small" sx={{ justifyContent: 'flex-start', fontSize: '0.72rem' }} />
                <Chip label="🗄  Supabase (自建/新加坡)" size="small" sx={{ justifyContent: 'flex-start', fontSize: '0.72rem' }} />
                <Chip label="🚀  Zeabur 部署" size="small" sx={{ justifyContent: 'flex-start', fontSize: '0.72rem' }} />
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                <Chip label="🖼  HuggingFace Datasets" size="small" sx={{ justifyContent: 'flex-start', fontSize: '0.72rem' }} />
                <Chip label="☁️  Supabase Storage" size="small" sx={{ justifyContent: 'flex-start', fontSize: '0.72rem' }} />
                <Chip label="🗄  Supabase Database" size="small" sx={{ justifyContent: 'flex-start', fontSize: '0.72rem' }} />
                <Chip label="🚀  Vercel 部署" size="small" sx={{ justifyContent: 'flex-start', fontSize: '0.72rem' }} />
              </Box>
            )}
          </Box>

          <Divider sx={{ mb: 1.5 }} />

          {/* Language selector */}
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
            🗣 LANGUAGE / 语言
          </Typography>
          <ToggleButtonGroup
            value={language}
            exclusive
            onChange={handleLanguage}
            fullWidth
            size="small"
          >
            <ToggleButton value={LANGUAGES.EN} sx={{ flex: 1, textTransform: 'none', fontWeight: 600 }}>
              English
            </ToggleButton>
            <ToggleButton value={LANGUAGES.ZH} sx={{ flex: 1, textTransform: 'none', fontWeight: 600 }}>
              中文
            </ToggleButton>
          </ToggleButtonGroup>
        </Paper>
      </Popover>
    </>
  );
}
