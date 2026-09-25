import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Role } from '@edu/shared';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { PublicLayout } from './components/PublicLayout';
import { Spinner } from './components/ui';

import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { CatalogCoursePage } from './pages/catalog/CatalogCoursePage';
import { ConsentPage } from './pages/ConsentPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { StudentDashboard } from './pages/student/StudentDashboard';
import { CourseLearnPage } from './pages/student/CourseLearnPage';
import { LecturePage } from './pages/student/LecturePage';
import { QuizPage } from './pages/student/QuizPage';
import { PracticalPage } from './pages/student/PracticalPage';
import { CertificatesPage } from './pages/student/CertificatesPage';
import { CoursesListPage } from './pages/manage/CoursesListPage';
import { CourseEditorPage } from './pages/manage/CourseEditorPage';
import { QuizEditorPage } from './pages/manage/QuizEditorPage';
import { PracticalEditorPage } from './pages/manage/PracticalEditorPage';
import { DashboardsPage } from './pages/manage/DashboardsPage';
import { RequestsPage } from './pages/manage/RequestsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { CohortsPage } from './pages/admin/CohortsPage';
import { OverviewPage } from './pages/admin/OverviewPage';
import { ExportPage } from './pages/admin/ExportPage';

function FullscreenSpinner() {
  return <div className="grid min-h-screen place-items-center"><Spinner className="h-8 w-8 text-brand" /></div>;
}

/**
 * Требует аутентификацию + (опц.) роль. Студентам-контенту — гейт согласия (FR-R.6).
 * Аноним: «/» → публичный каталог, прочее → вход с возвратом (?next).
 */
function Guard({ roles, requireConsent, children }: { roles?: Role[]; requireConsent?: boolean; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const here = location.pathname + location.search;
  if (loading) return <FullscreenSpinner />;
  if (!user) {
    if (location.pathname === '/') return <Navigate to="/catalog" replace />;
    return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  if (requireConsent && user.role === Role.STUDENT && !user.researchConsentAt) {
    return <Navigate to={`/consent?next=${encodeURIComponent(here)}`} replace />;
  }
  return <>{children}</>;
}

/** Каталог открыт всем: гость — публичная оболочка, вошедший — обычная (с навигацией). */
function CatalogShell() {
  const { user, loading } = useAuth();
  if (loading) return <FullscreenSpinner />;
  return user ? <AppShell /> : <PublicLayout />;
}

/** Корневой редирект по роли. */
function RoleHome() {
  const { user, loading } = useAuth();
  if (loading) return <FullscreenSpinner />;
  if (!user) return <Navigate to="/catalog" replace />;
  if (user.role === Role.STUDENT) return <StudentDashboard />;
  return <Navigate to="/manage/courses" replace />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/change-password', element: <Guard><ChangePasswordPage /></Guard> },
  { path: '/consent', element: <Guard roles={[Role.STUDENT]}><ConsentPage /></Guard> },
  // Публичный каталог курсов (без входа). Контент — только после одобрения заявки.
  {
    element: <CatalogShell />,
    children: [
      { path: '/catalog', element: <CatalogPage /> },
      { path: '/catalog/:courseId', element: <CatalogCoursePage /> },
    ],
  },
  {
    element: <Guard><AppShell /></Guard>,
    children: [
      { path: '/', element: <RoleHome /> },
      // Студент
      { path: '/learn/:courseId/:enrollmentId', element: <Guard roles={[Role.STUDENT]} requireConsent><CourseLearnPage /></Guard> },
      { path: '/learn/:courseId/:enrollmentId/lecture/:lectureId', element: <Guard roles={[Role.STUDENT]} requireConsent><LecturePage /></Guard> },
      { path: '/learn/:courseId/:enrollmentId/quiz/:quizId', element: <Guard roles={[Role.STUDENT]} requireConsent><QuizPage /></Guard> },
      { path: '/learn/:courseId/:enrollmentId/practical/:taskId', element: <Guard roles={[Role.STUDENT]} requireConsent><PracticalPage /></Guard> },
      { path: '/certificates', element: <Guard roles={[Role.STUDENT]}><CertificatesPage /></Guard> },
      // Менеджер / админ
      { path: '/manage/courses', element: <Guard roles={[Role.COURSE_MANAGER, Role.ADMIN]}><CoursesListPage /></Guard> },
      { path: '/manage/courses/:id', element: <Guard roles={[Role.COURSE_MANAGER, Role.ADMIN]}><CourseEditorPage /></Guard> },
      { path: '/manage/quiz/:quizId', element: <Guard roles={[Role.COURSE_MANAGER, Role.ADMIN]}><QuizEditorPage /></Guard> },
      { path: '/manage/practical/:taskId', element: <Guard roles={[Role.COURSE_MANAGER, Role.ADMIN]}><PracticalEditorPage /></Guard> },
      { path: '/manage/requests', element: <Guard roles={[Role.COURSE_MANAGER, Role.ADMIN]}><RequestsPage /></Guard> },
      { path: '/manage/dashboards', element: <Guard roles={[Role.COURSE_MANAGER, Role.ADMIN]}><DashboardsPage /></Guard> },
      // Только админ
      { path: '/admin/users', element: <Guard roles={[Role.ADMIN]}><UsersPage /></Guard> },
      { path: '/admin/cohorts', element: <Guard roles={[Role.ADMIN]}><CohortsPage /></Guard> },
      { path: '/admin/overview', element: <Guard roles={[Role.ADMIN]}><OverviewPage /></Guard> },
      { path: '/admin/export', element: <Guard roles={[Role.ADMIN]}><ExportPage /></Guard> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
