import { Suspense, lazy, ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RefetchProvider } from "@/contexts/RefetchContext";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { PlanLimitModal } from "@/components/PlanLimitModal";

const RELOAD_KEY = "chunk-reload";

function isChunkLoadError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? "";
  const name = (error as { name?: string })?.name ?? "";
  return (
    name === "ChunkLoadError" ||
    message.includes("dynamically imported module") ||
    message.includes("module script failed") ||
    message.includes("Loading chunk") ||
    message.includes("Loading CSS chunk") ||
    message.includes("Unable to preload CSS") ||
    message.includes("is not a valid JavaScript MIME type")
  );
}

function lazyWithReload<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    importFn().catch((error) => {
      if (isChunkLoadError(error) && !sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, "1");
        window.location.reload();
        return new Promise(() => {});
      }

      sessionStorage.removeItem(RELOAD_KEY);
      throw error;
    }),
  );
}

// Eager-load critical routes
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

// Lazy-load secondary routes
const ForgotPassword = lazyWithReload(() => import("./pages/ForgotPassword"));
const ResetPassword = lazyWithReload(() => import("./pages/ResetPassword"));
const Onboarding = lazyWithReload(() => import("./pages/Onboarding"));
const Campaigns = lazyWithReload(() => import("./pages/Campaigns"));
const Sales = lazyWithReload(() => import("./pages/Sales"));
const Integrations = lazyWithReload(() => import("./pages/Integrations"));
const Settings = lazyWithReload(() => import("./pages/Settings"));
const Financial = lazyWithReload(() => import("./pages/Financial"));
const Rules = lazyWithReload(() => import("./pages/Rules"));
const Tracking = lazyWithReload(() => import("./pages/Tracking"));
const Terms = lazyWithReload(() => import("./pages/Terms"));
const Privacy = lazyWithReload(() => import("./pages/Privacy"));
const NotFound = lazyWithReload(() => import("./pages/NotFound"));
const AdminLayout = lazyWithReload(() => import("./components/admin/AdminLayout").then((m) => ({ default: m.AdminLayout as ComponentType<any> })));
const AdminDashboard = lazyWithReload(() => import("./pages/admin/AdminDashboard"));
const AdminUsers = lazyWithReload(() => import("./pages/admin/AdminUsers"));
const AdminUserDetail = lazyWithReload(() => import("./pages/admin/AdminUserDetail"));
const AdminPlans = lazyWithReload(() => import("./pages/admin/AdminPlans"));

// Clear the reload flag on successful app load
sessionStorage.removeItem(RELOAD_KEY);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="sentinel-theme"
    >
    <AppErrorBoundary>
      <AuthProvider>
        <ImpersonationProvider>
          <WorkspaceProvider>
              <RefetchProvider>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <BrowserRouter>
                    <PlanLimitModal />
                    <Suspense
                      fallback={
                        <div className="flex min-h-screen items-center justify-center bg-background px-6">
                          <div className="flex flex-col items-center gap-3">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          </div>
                        </div>
                      }
                    >
                      <Routes>
                        {/* Public Routes - Login is the root */}
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/login" element={<Login />} />
                        {/* Nao ha cadastro publico: as contas nascem em Configuracoes > Usuarios. */}
                        <Route path="/register" element={<Navigate to="/login" replace />} />
                        <Route path="/forgot-password" element={<ForgotPassword />} />
                        <Route path="/reset-password" element={<ResetPassword />} />
                        <Route path="/terms" element={<Terms />} />
                        <Route path="/privacy" element={<Privacy />} />

                        {/* Protected Routes */}
                        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
                        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                        <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
                        <Route path="/sales" element={<ProtectedRoute><Sales /></ProtectedRoute>} />
                        <Route path="/tracking" element={<ProtectedRoute><Tracking /></ProtectedRoute>} />
                        <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
                        <Route path="/financial" element={<ProtectedRoute><Financial /></ProtectedRoute>} />
                        <Route path="/rules" element={<ProtectedRoute><Rules /></ProtectedRoute>} />
                        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

                        {/* Admin Routes */}
                        <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminLayout /></ProtectedRoute>}>
                          <Route index element={<AdminDashboard />} />
                          <Route path="users" element={<AdminUsers />} />
                          <Route path="users/:id" element={<AdminUserDetail />} />
                          <Route path="plans" element={<AdminPlans />} />
                        </Route>

                        {/* Catch-all */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Suspense>
                  </BrowserRouter>
                </TooltipProvider>
              </RefetchProvider>
          </WorkspaceProvider>
        </ImpersonationProvider>
      </AuthProvider>
    </AppErrorBoundary>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
