import { Link, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { Card, Empty } from "./components/ui";
import { useAuth } from "./lib/auth";
import { AuditPage, UsersPage } from "./pages/AdminPages";
import { ComparePage } from "./pages/ComparePage";
import { FlightDetailPage } from "./pages/FlightDetailPage";
import { FlightsPage } from "./pages/FlightsPage";
import { LoginPage } from "./pages/LoginPage";
import { ModelPage } from "./pages/ModelPage";
import { OverviewPage } from "./pages/OverviewPage";

export function App() {
  const { me } = useAuth();
  if (!me) return <LoginPage />;
  const isAdmin = me.role === "ADMIN";
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="flights" element={<FlightsPage />} />
        <Route path="flights/:id" element={<FlightDetailPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="model" element={<ModelPage />} />
        <Route path="users" element={isAdmin ? <UsersPage /> : <Navigate to="/" replace />} />
        <Route path="audit" element={isAdmin ? <AuditPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Card><Empty title="Page not found" action={<Link className="btn" to="/">Back to overview</Link>} /></Card>} />
      </Route>
    </Routes>
  );
}
