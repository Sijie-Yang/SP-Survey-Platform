import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box, CircularProgress } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { RegionProvider } from './contexts/RegionContext';
import { createCustomTheme, DEFAULT_THEME_KEY } from './themes/themeConfig';
import { ToastProvider } from './components/layout/ToastProvider';
const SurveyApp = lazy(() => import('./SurveyApp'));
const AdminApp = lazy(() => import('./AdminApp'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const LiveSurveysPage = lazy(() => import('./pages/LiveSurveysPage'));
const PapersLibraryPage = lazy(() => import('./pages/PapersLibraryPage'));
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

const theme = createCustomTheme(DEFAULT_THEME_KEY);

function ProtectedAdmin() {
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

  return <AdminApp />;
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

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ToastProvider>
        <AuthProvider>
          <RegionProvider>
            <Router>
              <Suspense fallback={<Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Loading" /></Box>}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/papers" element={<PapersLibraryPage />} />
                <Route path="/news" element={<NewsPage />} />
                <Route path="/news/:slug" element={<NewsPage />} />
                <Route path="/request-template" element={<RequestTemplatePage />} />
                <Route path="/request-survey-design" element={<RequestSurveyDesignPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/live" element={<LiveSurveysPage />} />
                <Route path="/bench" element={<SpBenchPage />} />
                <Route path="/survey" element={<SurveyApp />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/oauth/mcp" element={<McpOAuthPage />} />
                <Route path="/admin" element={<ProtectedAdmin />} />
                <Route path="/admin/integrations" element={<ProtectedIntegrations />} />
                <Route path="/admin-dashboard" element={<ProtectedAdminDashboard />} />
                <Route path="/skills" element={<ProtectedSkillLibrary />} />
                <Route path="/skill-editor" element={<ProtectedSkillEditor />} />
                <Route path="/skill-editor/:id" element={<ProtectedSkillEditor />} />
              </Routes>
              </Suspense>
            </Router>
          </RegionProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
