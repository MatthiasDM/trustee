import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { I18nProvider } from "./lib/i18n";
import { registerSW } from "./lib/push";
import { AppShell } from "./components/Layout";
import { ForgotPasswordPage, InvitePage, LoginPage, RegisterPage, ResetPasswordPage } from "./pages/AuthPages";
import { HomePage } from "./pages/HomePage";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { PostDetailPage, PostsPage } from "./pages/PostsPage";
import { PollDetailPage, PollsPage } from "./pages/PollsPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { MembersPage } from "./pages/MembersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { HelpPage } from "./pages/HelpPage";
import { LedgerPage } from "./pages/LedgerPage";
import { OrgPage } from "./pages/OrgPage";
import { LegalPage } from "./pages/LegalPage";

function Localized({ children }: { children: React.ReactNode }) { const { user } = useAuth(); return <I18nProvider locale={user?.locale ?? (navigator.language.startsWith("fr") ? "fr" : navigator.language.startsWith("en") ? "en" : "nl")}>{children}</I18nProvider>; }

registerSW();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider><Localized>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {["/voorwaarden", "/privacy", "/verwerkersovereenkomst", "/beveiliging"].map((p) => <Route key={p} path={p} element={<LegalPage />} />)}
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/org/:orgId" element={<OrgPage />} />
            <Route path="/b/:buildingId" element={<DashboardPage />} />
            <Route path="/b/:buildingId/documents" element={<DocumentsPage />} />
            <Route path="/b/:buildingId/posts" element={<PostsPage />} />
            <Route path="/b/:buildingId/posts/:postId" element={<PostDetailPage />} />
            <Route path="/b/:buildingId/polls" element={<PollsPage />} />
            <Route path="/b/:buildingId/polls/:pollId" element={<PollDetailPage />} />
            <Route path="/b/:buildingId/meetings" element={<MeetingsPage />} />
            <Route path="/b/:buildingId/members" element={<MembersPage />} />
            <Route path="/b/:buildingId/ledger" element={<LedgerPage />} />
            <Route path="/b/:buildingId/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Localized></AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
