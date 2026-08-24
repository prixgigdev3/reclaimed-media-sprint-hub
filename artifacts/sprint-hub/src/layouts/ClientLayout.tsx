import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { LayoutDashboard, BookOpen, User, LogOut, Menu, FolderOpen, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { NotificationBell } from "@/components/NotificationBell";
import { useGetMe } from "@workspace/api-client-react";
import { BrandLockup } from "@/components/BrandLockup";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/modules", label: "Modules", icon: BookOpen },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/account", label: "Account", icon: User },
];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { logout } = useAuth();
  const { data: me } = useGetMe();
  // Show the notification bell to anyone in client view — including admins
  // who are impersonating a client (so they can preview what the client
  // would see). The /me/notifications endpoint already scopes results to
  // the effective user, so impersonated views surface that client's feed.
  const showBell = me?.role === "client";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void } = {}) => (
    <>
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
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
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <ImpersonationBanner />
      <div className="flex-1 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <BrandLockup size="sm" />
        <div className="flex items-center gap-1">
        {showBell && <NotificationBell audience="client" />}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="w-6 h-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 flex flex-col">
            <div className="mb-8"><BrandLockup /></div>
            <nav className="flex-1 space-y-2">
              <NavLinks onNavigate={() => setMobileNavOpen(false)} />
            </nav>
            <Button variant="ghost" className="justify-start text-muted-foreground mt-auto" onClick={() => { setMobileNavOpen(false); logout(); }}>
              <LogOut className="w-5 h-5 mr-3" />
              Logout
            </Button>
          </SheetContent>
        </Sheet>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card p-6">
        <div className="flex items-center justify-between mb-10">
          <BrandLockup />
          {showBell && <NotificationBell audience="client" />}
        </div>
        <nav className="flex-1 space-y-2">
          <NavLinks />
        </nav>
        <Button variant="ghost" className="justify-start text-muted-foreground mt-auto" onClick={logout}>
          <LogOut className="w-5 h-5 mr-3" />
          Logout
        </Button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
      </div>
    </div>
  );
}
