import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, ArrowLeft, Crown, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const adminNavItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/admin/users', label: 'Usuários', icon: Users },
  { to: '/admin/plans', label: 'Planos', icon: Crown },
];

export function AdminLayout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen glass-sidebar transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className={cn(
            "flex h-14 items-center border-b border-foreground/5",
            collapsed ? "justify-center px-2" : "justify-between px-6"
          )}>
            <Logo size={collapsed ? 'sm' : 'md'} showText={!collapsed} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed(!collapsed)}
              className="text-muted-foreground/60 hover:bg-foreground/5 hover:text-muted-foreground h-8 w-8"
            >
              {collapsed ? <PanelLeft className="h-4 w-4" strokeWidth={1.5} /> : <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />}
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-2">
            <TooltipProvider delayDuration={0}>
              {adminNavItems.map((item) => {
                const isActive = item.exact
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to);

                const link = (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      collapsed && 'justify-center px-2',
                      isActive
                        ? 'bg-foreground/8 text-foreground'
                        : 'text-muted-foreground/60 hover:bg-foreground/5 hover:text-muted-foreground'
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                    {!collapsed && item.label}
                  </NavLink>
                );

                if (collapsed) {
                  return (
                    <Tooltip key={item.to}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  );
                }

                return link;
              })}
            </TooltipProvider>
          </nav>

          {/* Footer */}
          <div className="border-t border-foreground/5 p-2">
            <TooltipProvider delayDuration={0}>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <NavLink
                      to="/dashboard"
                      className="flex items-center justify-center rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-muted-foreground"
                    >
                      <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.5} />
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right">Voltar ao App</TooltipContent>
                </Tooltip>
              ) : (
                <NavLink
                  to="/dashboard"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-muted-foreground"
                >
                  <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.5} />
                  Voltar ao App
                </NavLink>
              )}
            </TooltipProvider>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={cn(
        "flex-1 p-8 transition-all duration-300",
        collapsed ? "ml-16" : "ml-64"
      )}>
        <Outlet />
      </main>
    </div>
  );
}
