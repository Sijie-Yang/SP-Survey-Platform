import React from 'react';
import { Box, Container, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import PublicHeader, { PublicFooter, GITHUB_REPO_URL } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';

export const PRIVACY_UPDATED = '2026-11-26';
export const SUPPORT_URL = `${GITHUB_REPO_URL}/issues`;

const p = (en, zh) => ({ en, zh });

/** Plain sections: what SP-Survey keeps, why, where, for how long, and who to contact. */
export const PRIVACY_SECTIONS = [
  {
    id: 'who',
    title: p('Who we are', '我们是谁'),
    body: [
      p('SP-Survey (sp-survey.org) is a research platform for perception surveys, developed by the Urban Analytics Lab at the National University of Singapore. This policy covers the website, the participant survey pages and the SP-Survey connector (MCP server at https://sp-survey.org/mcp) used from AI apps such as Claude.',
        'SP-Survey（sp-survey.org）是新加坡国立大学城市分析实验室（Urban Analytics Lab）开发的感知问卷研究平台。本政策适用于网站、参与者问卷页面，以及在 Claude 等 AI 应用里使用的 SP-Survey 连接器（MCP 服务器 https://sp-survey.org/mcp）。'),
    ],
  },
  {
    id: 'collect',
    title: p('What we keep', '我们保存什么'),
    body: [
      p('Researcher accounts: email address, password (handled by our sign-in provider; we never see it in plain text), nickname, and the projects you create: survey settings, pages, media files, templates and published versions.',
        '研究者账号：邮箱、密码（由登录服务处理，我们看不到明文）、昵称，以及你创建的项目：问卷设置、页面、媒体文件、模板和发布版本。'),
      p('Survey participants: the answers they submit, the images they were shown, timing, and basic technical details of the device (browser type, screen size, and link parameters such as a recruitment platform ID). We do not ask participants for names or email addresses unless a researcher adds such a question.',
        '问卷参与者：提交的回答、看到的图片、用时，以及设备的基本技术信息（浏览器类型、屏幕尺寸、链接参数，例如招募平台 ID）。除非研究者自己加了相关题目，平台不收集参与者姓名或邮箱。'),
      p('Forum posts, feedback and contributions you choose to submit. For rate limits on anonymous feedback we store a one-way hash of the network address, not the address itself.',
        '你主动提交的论坛帖子、建议和投稿。为了限制匿名建议的频率，我们只保存网络地址的单向哈希，不保存地址本身。'),
    ],
  },
  {
    id: 'connector',
    title: p('The SP-Survey connector for AI apps', '给 AI 应用用的 SP-Survey 连接器'),
    body: [
      p('When you connect SP-Survey to an AI app, you sign in on sp-survey.org and approve the permissions it asks for. We store the app\'s registration and hashed access and refresh tokens so the connection keeps working; you can disconnect it in the AI app at any time.',
        '把 SP-Survey 连到 AI 应用时，你会在 sp-survey.org 登录并同意它申请的权限。我们保存该应用的注册信息，以及经过哈希处理的访问令牌和刷新令牌，以便连接持续有效；你可以随时在 AI 应用里断开连接。'),
      p('The connector only receives what the AI app sends to a tool (for example a survey page, a project ID or a question) and only returns your own SP-Survey data. It does not read your chat history, memory or other files in the AI app. What you type to the AI app is handled by that app\'s provider under its own privacy policy.',
        '连接器只接收 AI 应用发给某个工具的内容（例如问卷页面、项目 ID 或一个问题），只返回你自己的 SP-Survey 数据。它不会读取你在 AI 应用里的聊天记录、记忆或其他文件。你在 AI 应用里输入的内容由该应用的提供方按其隐私政策处理。'),
      p('Each tool works only on projects you own. Deleting and publishing need an explicit confirmation. Administrator tools are shown only to platform administrators.',
        '每个工具只能操作你自己的项目。删除和发布需要明确确认。管理员工具只对平台管理员显示。'),
    ],
  },
  {
    id: 'use',
    title: p('How we use it', '我们怎么使用这些数据'),
    body: [
      p('Only to run the platform: to show and save surveys, to give researchers their results and exports, to keep accounts secure, to send account emails (password reset) and to fix problems. We do not sell data, show advertising or use participant answers to train AI models.',
        '只用于运行平台：显示和保存问卷、把结果和导出交给研究者、保障账号安全、发送账号邮件（重置密码）以及排查问题。我们不出售数据、不投放广告，也不用参与者的回答训练 AI 模型。'),
      p('Researchers own the data their surveys collect and are responsible for their own ethics approval and consent text.',
        '问卷收集的数据归研究者所有，研究者负责自己的伦理审批和知情同意说明。'),
    ],
  },
  {
    id: 'share',
    title: p('Services that process data for us', '为我们处理数据的服务'),
    body: [
      p('Supabase (database and sign-in), Cloudflare (hosting, Workers and R2 file storage), and Resend (account emails). If a researcher uses the built-in AI assistant or AI-respondent pretests, the survey content they send is processed by the AI model provider they choose or by the platform\'s configured model. We do not share data with anyone else unless the law requires it.',
        'Supabase（数据库和登录）、Cloudflare（网站托管、Workers 和 R2 文件存储）和 Resend（账号邮件）。研究者使用内置 AI 助手或 AI 受访者预测试时，所发送的问卷内容由其选择的模型服务或平台配置的模型处理。除法律要求外，我们不与其他任何人共享数据。'),
    ],
  },
  {
    id: 'keep',
    title: p('How long we keep it', '保存多久'),
    body: [
      p('Projects, media and responses are kept until the researcher deletes them; researchers can delete projects, media files and single responses themselves. Connector access tokens expire after one hour and refresh tokens after 30 days (each refresh issues a new one); disconnecting revokes them. Temporary upload files are deleted after a successful import, and leftovers are cleaned up later. You can ask us to delete your account and its data.',
        '项目、媒体和回答会一直保存，直到研究者删除；研究者可以自己删除项目、媒体文件和单条回答。连接器的访问令牌一小时后过期，刷新令牌 30 天后过期（每次刷新会换一个新的）；断开连接会使其作废。临时上传文件在导入成功后删除，残留的会在之后清理。你可以要求我们删除你的账号和数据。'),
    ],
  },
  {
    id: 'contact',
    title: p('Contact', '联系我们'),
    body: [
      p(`Questions, data requests and security reports: open an issue at ${SUPPORT_URL} or write in the Help section of the forum (sp-survey.org/forum). We may update this policy; the date at the top shows the latest version.`,
        `问题、数据请求和安全问题：在 ${SUPPORT_URL} 提交 issue，或在论坛的“求助”版块留言（sp-survey.org/forum）。本政策可能更新，页面顶部的日期为最新版本。`),
    ],
  },
];

export default function PrivacyPage() {
  const { language } = useRegion();
  const zh = language === 'zh';
  const text = (value) => (zh ? value.zh : value.en);
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <PublicHeader />
      <Container maxWidth="md" sx={{ flex: 1, py: { xs: 5, md: 8 } }}>
        <Typography variant="h4" component="h1" fontWeight={800} sx={{ mb: 1 }}>
          {zh ? '隐私政策' : 'Privacy policy'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          {zh ? `更新日期：${PRIVACY_UPDATED}` : `Last updated: ${PRIVACY_UPDATED}`}
          {' · '}
          <Link component={RouterLink} to="/docs/connect-ai">{zh ? '在 Claude 等 AI 应用里使用 SP-Survey' : 'Use SP-Survey in Claude and other AI apps'}</Link>
        </Typography>
        {PRIVACY_SECTIONS.map((section) => (
          <Box component="section" key={section.id} id={section.id} sx={{ mb: 4 }}>
            <Typography variant="h6" component="h2" fontWeight={700} sx={{ mb: 1 }}>{text(section.title)}</Typography>
            {section.body.map((paragraph, index) => (
              <Typography key={index} variant="body1" sx={{ mb: 1.5, lineHeight: 1.75 }}>{text(paragraph)}</Typography>
            ))}
          </Box>
        ))}
      </Container>
      <PublicFooter />
    </Box>
  );
}
