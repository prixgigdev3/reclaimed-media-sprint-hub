import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { LayoutDashboard, Users, FileText, Settings, Shield, LogOut, Menu, FileSignature, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useGetMe } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { PreviewModeSwitch } from "@/components/PreviewModeSwitch";
import { NotificationBell } from "@/components/NotificationBell";
import { BrandLockup } from "@/components/BrandLockup";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, scope: "dashboard" },
  { href: "/admin/clients", label: "Clients", icon: Users, scope: "clients" },
  { href: "/admin/content", label: "Content", icon: FileText, scope: "content" },
  { href: "/admin/agreements", label: "Agreements", icon: FileSignature, scope: "agreements" },
  { href: "/admin/support", label: "Support", icon: LifeBuoy, scope: "support" },
  { href: "/admin/settings", label: "Settings", icon: Settings, scope: "settings" },
  { href: "/admin/admins", label: "Admins", icon: Shield, scope: "admins" },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { logout } = useAuth();
  const { data: me } = useGetMe();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Scope filter: super_admins always see everything; admins/viewers with an
  // empty scope list also see everything (legacy default = full access);
  // otherwise the nav item must appear in the allowlist.
  const scopes = me?.adminScopes ?? [];
  const isSuper = me?.role === "super_admin";
  const SUPER_ONLY = new Set(["settings", "admins"]);
  const visibleNav = NAV_ITEMS.filter((item) => {
    if (SUPER_ONLY.has(item.scope) && !isSuper) return false;
    if (isSuper) return true;
    if (scopes.length === 0) return true;
    return scopes.includes(item.scope);
  });

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void } = {}) => (
    <>
      {visibleNav.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.href || (item.href !== "/admin" && location.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} onClick={() => onNavigate?.()}>
            <div className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </div>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-slate-50 dark:bg-slate-900">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <BrandLockup size="sm" />
        <div className="flex items-center gap-1">
        <NotificationBell audience="admin" />
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="w-6 h-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 flex flex-col bg-card">
            <div className="mb-8">
              <div className="mb-2"><BrandLockup size="sm" /></div>
              {me?.user && (
                <div className="flex flex-col items-start gap-1">
                  <span className="text-sm font-medium">{me.user.firstName} {me.user.lastName}</span>
                  <Badge variant="secondary" className="text-xs uppercase">{me.role.replace('_', ' ')}</Badge>
                </div>
              )}
            </div>
            <nav className="flex-1 space-y-2">
              <NavLinks onNavigate={() => setMobileNavOpen(false)} />
            </nav>
            <div className="mt-4">
              <PreviewModeSwitch />
            </div>
            <Button variant="ghost" className="justify-start text-muted-foreground mt-2" onClick={() => { setMobileNavOpen(false); logout(); }}>
              <LogOut className="w-5 h-5 mr-3" />
              Logout
            </Button>
          </SheetContent>
        </Sheet>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card p-6">
        <div className="mb-10">
          <div className="mb-4"><BrandLockup /></div>
          {me?.user && (
            <div className="flex flex-col items-start gap-1 p-3 bg-muted rounded-lg border border-border/50">
              <span className="text-sm font-medium">{me.user.firstName} {me.user.lastName}</span>
              <Badge variant="outline" className="text-[10px] tracking-wider font-semibold uppercase bg-background">{me.role.replace('_', ' ')}</Badge>
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-2">
          <NavLinks />
        </nav>
        <div className="mt-4">
          <PreviewModeSwitch />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Button variant="ghost" className="justify-start text-muted-foreground flex-1" onClick={logout}>
            <LogOut className="w-5 h-5 mr-3" />
            Logout
          </Button>
          <NotificationBell audience="admin" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
