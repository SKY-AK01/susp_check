import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import RunResultsPage from "./pages/RunResultsPage";
import ImageDetailPage from "./pages/ImageDetailPage";
import DashboardPage from "./pages/DashboardPage";
import StudentPerformancePage from "./pages/StudentPerformancePage";
import Layout from "./components/Layout";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("access_token");
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="projects/:projectId/dashboard" element={<DashboardPage />} />
        <Route path="runs/:runId/results" element={<RunResultsPage />} />
        <Route path="runs/:runId/results/:resultId" element={<ImageDetailPage />} />
        <Route path="students/:studentId" element={<StudentPerformancePage />} />
      </Route>
    </Routes>
  );
}
