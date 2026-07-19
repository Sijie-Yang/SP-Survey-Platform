import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box, CircularProgress } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { RegionProvider } from './contexts/RegionContext';
import { createCustomTheme, DEFAULT_THEME_KEY } from './themes/themeConfig';
import { ToastProvider } from './components/layout/ToastProvider';
import SurveyApp from './SurveyApp';
import AdminApp from './AdminApp';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/LandingPage';
import LiveSurveysPage from './pages/LiveSurveysPage';
import PapersLibraryPage from './pages/PapersLibraryPage';
import RequestTemplatePage from './pages/RequestTemplatePage';
import RequestSurveyDesignPage from './pages/RequestSurveyDesignPage';
import TeamPage from './pages/TeamPage';
import AdminDashboard from './pages/AdminDashboard';
import SkillEditorPage from './pages/SkillEditorPage';
import SkillLibraryPage from './pages/SkillLibraryPage';
import IntegrationsPage from './pages/IntegrationsPage';
import McpOAuthPage from './pages/McpOAuthPage';

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
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/papers" element={<PapersLibraryPage />} />
                <Route path="/request-template" element={<RequestTemplatePage />} />
                <Route path="/request-survey-design" element={<RequestSurveyDesignPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/live" element={<LiveSurveysPage />} />
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
            </Router>
          </RegionProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
