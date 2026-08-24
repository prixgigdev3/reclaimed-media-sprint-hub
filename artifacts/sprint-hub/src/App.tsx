import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast, Toaster as SonnerToaster } from "sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, ShieldAlert } from "lucide-react";
import reclaimedWordmarkBlue from "@/assets/reclaimed-media-wordmark-blue.png";
import reclaimedWordmarkWhite from "@/assets/reclaimed-media-wordmark-white.png";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { BRAND_NAME } from "@/lib/brand";

import { ClientLayout } from "@/layouts/ClientLayout";
import { AdminLayout } from "@/layouts/AdminLayout";

import { ClientDashboard } from "@/pages/client/Dashboard";
import { ClientModules } from "@/pages/client/Modules";
import { ClientModuleDetail } from "@/pages/client/ModuleDetail";
import { ClientEpisode } from "@/pages/client/Episode";
import { ClientIcp } from "@/pages/client/Icp";
import { ClientAccount } from "@/pages/client/Account";
import { ClientAgreementSign } from "@/pages/client/AgreementSign";
import { ClientAgreements } from "@/pages/client/Agreements";
import { ClientSupport } from "@/pages/client/Support";
import { ClientDocuments } from "@/pages/client/Documents";

import { AdminDashboard } from "@/pages/admin/Dashboard";
import { AdminClients } from "@/pages/admin/Clients";
import { AdminClientDetail } from "@/pages/admin/ClientDetail";
import { AdminContent } from "@/pages/admin/Content";
import { AdminSettings } from "@/pages/admin/Settings";
import { AdminUsers } from "@/pages/admin/Admins";
import { AdminAgreements } from "@/pages/admin/Agreements";
import { AdminAgreementBuilder } from "@/pages/admin/AgreementBuilder";
import { AdminAgreementEdit } from "@/pages/admin/AgreementEdit";
import { AdminAgreementReview } from "@/pages/admin/AgreementReview";
import { AdminSupport } from "@/pages/admin/Support";
import { AdminActivity } from "@/pages/admin/Activity";

// Global safety net: any mutation that doesn't define its own onError
// will surface a toast so the user is never left guessing whether their
// click did something. Per-mutation onError handlers override this.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        toast.error(msg);
      },
    },
  },
});

function Login() {
  const { login } = useAuth();
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-background via-background to-muted/40 p-4">
      <Card className="w-full max-w-md shadow-lg border-border/60">
        <CardHeader className="text-center space-y-3 pb-4">
          <img
            src={reclaimedWordmarkBlue}
            alt={BRAND_NAME}
            className="mx-auto h-20 w-auto object-contain"
          />
          <CardDescription>Sign in to access your sprint, modules, and agreements.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={login} size="lg" className="w-full">
            <LogIn className="w-4 h-4 mr-2" /> Log in with Replit
          </Button>
          <div className="text-center pt-2 border-t border-border/60">
            <a href="/admin/login" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Operator? Admin login
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminLogin() {
  const { login } = useAuth();
  return (
    <div className="min-h-screen grid place-items-center bg-secondary p-4">
      <Card className="w-full max-w-md shadow-2xl border-border/60">
        <CardHeader className="text-center space-y-2 pb-4">
          <div className="mx-auto rounded-xl bg-primary grid place-items-center mb-2 px-4 py-2">
            <img src={reclaimedWordmarkWhite} alt={BRAND_NAME} className="h-8 w-auto object-contain" />
          </div>
          <CardTitle className="text-2xl tracking-tight">Admin Console</CardTitle>
          <CardDescription>Operator access only.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={login} size="lg" className="w-full">
            <LogIn className="w-4 h-4 mr-2" /> Operator Login
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function NoAccess() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <Card className="w-full max-w-md text-center shadow-sm">
        <CardHeader>
          <div className="mx-auto w-12 h-12 rounded-xl bg-amber-100 text-amber-700 grid place-items-center mb-2">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <CardTitle>No access</CardTitle>
          <CardDescription>
            You don't have an active account on this portal yet. If you've just signed up, please wait for an operator to grant access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={logout} className="w-full">Log out</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ProtectedRoute() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: me, isLoading: meLoading } = useGetMe({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetMeQueryKey()
    }
  });

  if (authLoading || (isAuthenticated && meLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (!me) return null;

  if (me.role === "client") {
    return (
      <ClientLayout>
        <OnboardingGate>
          <Switch>
            <Route path="/" component={ClientDashboard} />
            <Route path="/modules" component={ClientModules} />
            <Route path="/modules/:moduleId" component={ClientModuleDetail} />
            <Route path="/episodes/:episodeId" component={ClientEpisode} />
            <Route path="/icp" component={ClientIcp} />
            <Route path="/account" component={ClientAccount} />
            <Route path="/documents" component={ClientDocuments} />
            <Route path="/agreements" component={ClientAgreements} />
            <Route path="/agreements/:id" component={ClientAgreementSign} />
            <Route path="/support" component={ClientSupport} />
            <Route path="/admin/*" component={() => <Redirect to="/" />} />
            <Route component={NotFound} />
          </Switch>
        </OnboardingGate>
      </ClientLayout>
    );
  }

  if (me.role === "super_admin" || me.role === "admin" || me.role === "viewer") {
    return (
      <AdminLayout>
        <Switch>
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/admin/clients" component={AdminClients} />
          <Route path="/admin/clients/:id" component={AdminClientDetail} />
          <Route path="/admin/content" component={AdminContent} />
          {/* /admin/courses merged into /admin/content. Redirect any old bookmarks. */}
          <Route path="/admin/courses" component={() => <Redirect to="/admin/content" />} />
          <Route path="/admin/settings">
            {me.role === "super_admin" ? <AdminSettings /> : <Redirect to="/admin" />}
          </Route>
          <Route path="/admin/admins">
            {me.role === "super_admin" ? <AdminUsers /> : <Redirect to="/admin" />}
          </Route>
          <Route path="/admin/agreements" component={AdminAgreements} />
          <Route path="/admin/agreements/new" component={AdminAgreementBuilder} />
          <Route path="/admin/agreements/builder/:id" component={AdminAgreementBuilder} />
          <Route path="/admin/agreements/:id/edit" component={AdminAgreementEdit} />
          <Route path="/admin/agreements/assignments/:id" component={AdminAgreementReview} />
          {/* /admin/analytics merged into /admin (Dashboard). Redirect any
              old bookmarks so they don't 404. */}
          <Route path="/admin/analytics" component={() => <Redirect to="/admin" />} />
          <Route path="/admin/support" component={AdminSupport} />
          <Route path="/admin/activity" component={AdminActivity} />
          <Route path="/" component={() => <Redirect to="/admin" />} />
          <Route component={NotFound} />
        </Switch>
      </AdminLayout>
    );
  }

  return <NoAccess />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route component={ProtectedRoute} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
        <SonnerToaster richColors closeButton position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
