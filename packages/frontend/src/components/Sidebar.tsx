import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Megaphone,
  ShoppingCart,
  Link2,
  DollarSign,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Zap,
  Users,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/campaigns', icon: Megaphone, label: 'Campanhas' },
  { to: '/sales', icon: ShoppingCart, label: 'Vendas' },
  { to: '/tracking', icon: Users, label: 'Eventos' },
  { to: '/integrations', icon: Link2, label: 'Integrações' },
  { to: '/financial', icon: DollarSign, label: 'Financeiro' },
  { to: '/rules', icon: Zap, label: 'Regras' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
];

export function Sidebar({ onNavClick, onCollapsedChange }: { onNavClick?: () => void; onCollapsedChange?: (collapsed: boolean) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();

  const toggleCollapsed = (val: boolean) => {
    setCollapsed(val);
    onCollapsedChange?.(val);
  };

  return (
    <aside
      className={cn(
        'h-full glass-sidebar transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-foreground/5 px-4">
          {!collapsed && (
            <Logo />
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleCollapsed(!collapsed)}
            className="text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>


        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3 pt-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavClick}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
                  isActive
                    ? 'bg-foreground/8 text-foreground font-medium'
                    : 'text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5'
                )
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}

          {/* Admin Link */}
          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              onClick={onNavClick}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
                  isActive
                    ? 'bg-foreground/8 text-foreground font-medium'
                    : 'text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5'
                )
              }
            >
              <Shield className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
              {!collapsed && <span>Admin</span>}
            </NavLink>
          )}
        </nav>

        {/* Theme toggle + User email + Logout — bottom */}
        <div className="border-t border-foreground/5 p-3 space-y-1">
          <div className={cn('flex', collapsed ? 'justify-center' : 'justify-end')}>
            <ThemeToggle collapsed={collapsed} />
          </div>
          {!collapsed && user && (
            <p className="mb-2 truncate px-3 text-xs text-muted-foreground/80">
              {user.email}
            </p>
          )}
          <Button
            variant="ghost"
            onClick={logout}
            className={cn(
              'w-full justify-start gap-3 text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5 rounded-lg',
              collapsed && 'justify-center px-0'
            )}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
            {!collapsed && <span className="text-sm">Sair</span>}
          </Button>
        </div>
      </div>
    </aside>
  );
}
