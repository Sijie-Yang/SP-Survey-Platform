import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box, CircularProgress } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { RegionProvider } from './contexts/RegionContext';
import { createCustomTheme, DEFAULT_THEME_KEY } from './themes/themeConfig';
import { ToastProvider } from './components/layout/ToastProvider';
import { loginRedirectPath } from './lib/researcherEntry';
const QuestionPreviewPage = lazy(() => import('./components/admin/QuestionPreviewPage'));
const SurveyApp = lazy(() => import('./SurveyApp'));
const AdminApp = lazy(() => import('./AdminApp'));
const StudioPage = lazy(() => import('./pages/StudioPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const LiveSurveysPage = lazy(() => import('./pages/LiveSurveysPage'));
const PapersLibraryPage = lazy(() => import('./pages/PapersLibraryPage'));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const RequestTemplatePage = lazy(() => import('./pages/RequestTemplatePage'));
const RequestSurveyDesignPage = lazy(() => import('./pages/RequestSurveyDesignPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const SkillEditorPage = lazy(() => import('./pages/SkillEditorPage'));
const SkillLibraryPage = lazy(() => import('./pages/SkillLibraryPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const McpOAuthPage = lazy(() => import('./pages/McpOAuthPage'));
const SpBenchPage = lazy(() => import('./pages/SpBenchPage'));
const NewsPage = lazy(() => import('./pages/NewsPage'));
const ForumPage = lazy(() => import('./pages/ForumPage'));
const ContributePage = lazy(() => import('./pages/ContributePage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
const PublicationsPage = lazy(() => import('./pages/PublicationsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));

const theme = createCustomTheme(DEFAULT_THEME_KEY);

function ProtectedAdmin() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    // After signing in, the researcher lands on the same link (project and tab included).
    return <Navigate to={loginRedirectPath(location)} replace />;
  }

  return <AdminApp />;
}

function ProtectedStudio() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={loginRedirectPath(location)} replace />;
  }

  return <StudioPage />;
}

function ProtectedAdminDashboard() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <AdminDashboard />;
}

function ProtectedSkillLibrary() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <SkillLibraryPage />;
}

function ProtectedSkillEditor() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <SkillEditorPage />;
}

function ProtectedIntegrations() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <IntegrationsPage />;
}

const router = createBrowserRouter(createRoutesFromElements(
              <>
                <Route path="/" element={<LandingPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/papers" element={<PapersLibraryPage />} />
                <Route path="/publications" element={<PublicationsPage />} />
                <Route path="/contribute" element={<ContributePage />} />
                <Route path="/docs" element={<DocsPage />} />
                <Route path="/docs/:docId" element={<DocsPage />} />
                <Route path="/tutorial" element={<Navigate to="/docs/2013-salesses-collaborative" replace />} />
                <Route path="/news" element={<NewsPage />} />
                <Route path="/news/:slug" element={<NewsPage />} />
                <Route path="/forum" element={<ForumPage />} />
                <Route path="/forum/:id" element={<ForumPage />} />
                <Route path="/request-template" element={<RequestTemplatePage />} />
                <Route path="/request-survey-design" element={<RequestSurveyDesignPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/live" element={<LiveSurveysPage />} />
                <Route path="/bench" element={<SpBenchPage />} />
                <Route path="/survey" element={<SurveyApp />} />
                <Route path="/s/:slug" element={<SurveyApp />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/oauth/mcp" element={<McpOAuthPage />} />
                <Route path="/studio" element={<ProtectedStudio />} />
                <Route path="/studio/:projectId" element={<ProtectedStudio />} />
                <Route path="/admin" element={<ProtectedAdmin />} />
                <Route path="/admin/integrations" element={<ProtectedIntegrations />} />
                <Route path="/admin-dashboard" element={<ProtectedAdminDashboard />} />
                <Route path="/skills" element={<ProtectedSkillLibrary />} />
                <Route path="/skill-editor" element={<ProtectedSkillEditor />} />
                <Route path="/skill-editor/:id" element={<ProtectedSkillEditor />} />
                <Route path="*" element={<NotFoundPage />} />
              </>
));

export default function App() {
  // A preview only consumes its parent's draft snapshot; never load auth, projects or responses.
  if (window.location.pathname === '/question-preview') {
    return <ThemeProvider theme={theme}><CssBaseline /><RegionProvider>
      <Suspense fallback={<CircularProgress aria-label="Loading preview" />}><QuestionPreviewPage /></Suspense>
    </RegionProvider></ThemeProvider>;
  }
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ToastProvider>
        <AuthProvider>
          <RegionProvider>

              <Suspense fallback={<Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Loading" /></Box>}>
              <RouterProvider router={router} />

              </Suspense>

          </RegionProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
