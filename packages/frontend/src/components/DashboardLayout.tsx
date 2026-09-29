import { ReactNode, useState } from 'react';
import { Logo } from '@/components/Logo';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Menu, X, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { ExpiredAccessModal } from '@/components/ExpiredAccessModal';
import { WorkspaceSync } from '@/components/WorkspaceSync';
import { ThemeToggle } from '@/components/ThemeToggle';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user } = useAuth();
  const { isImpersonating, target, stopImpersonation } = useImpersonation();

  return (
    <div className="min-h-screen bg-background">
      <WorkspaceSync />
      <ExpiredAccessModal />

      {/* Impersonation Banner */}
      {isImpersonating && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 bg-amber-500/90 px-4 py-2 text-black backdrop-blur-sm">
          <Eye className="h-4 w-4" />
          <span className="text-sm font-medium">
            Visualizando como: <strong>{target?.userName}</strong>
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={stopImpersonation}
            className="ml-2 h-7 border-black/30 bg-transparent text-black hover:bg-black/10"
          >
            <X className="mr-1 h-3 w-3" />
            Sair
          </Button>
        </div>
      )}
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 transform transition-all duration-300 lg:translate-x-0',
          sidebarCollapsed ? 'w-16' : 'w-64',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <Sidebar onNavClick={() => setSidebarOpen(false)} onCollapsedChange={setSidebarCollapsed} />
      </div>

      {/* Main Content */}
      <div className={cn('transition-all duration-300', sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64')}>
        {/* Mobile Header */}
        <div className="sticky top-0 z-20 flex h-14 items-center gap-4 glass-header px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            className="text-muted-foreground hover:text-foreground hover:bg-foreground/5"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Logo />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        {/* Page Content */}
        <main className={cn("p-4 lg:px-8 lg:pb-8 lg:pt-[84px]", isImpersonating && "pt-14 lg:pt-[120px]")}>{children}</main>
      </div>
    </div>
  );
}
