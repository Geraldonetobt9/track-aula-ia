import { useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';

/**
 * Saíram daqui, junto com os recursos que sumiram do produto: WorkspaceSync,
 * ExpiredAccessModal (dependia de plano) e o banner de impersonation.
 */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 transform transition-all duration-300 lg:translate-x-0',
          sidebarCollapsed ? 'w-16' : 'w-64',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar onNavClick={() => setSidebarOpen(false)} onCollapsedChange={setSidebarCollapsed} />
      </div>

      <div className={cn('transition-all duration-300', sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64')}>
        <div className="glass-header sticky top-0 z-20 flex h-14 items-center gap-4 px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold">Dashboard Anibal</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
