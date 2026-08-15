import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  LayoutDashboard,
  Megaphone,
  ShoppingCart,
  Link2,
  DollarSign,
  Settings,
  Zap,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react';

// Sem VTurb, sem Eventos, sem Admin: as três saíram do produto.
const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/campaigns', icon: Megaphone, label: 'Campanhas' },
  { to: '/sales', icon: ShoppingCart, label: 'Vendas' },
  { to: '/integrations', icon: Link2, label: 'Integrações' },
  { to: '/financial', icon: DollarSign, label: 'Financeiro' },
  { to: '/rules', icon: Zap, label: 'Regras' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
];

interface SidebarProps {
  onNavClick?: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ onNavClick, onCollapsedChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { email, signOut } = useAuth();

  const toggleCollapsed = (value: boolean) => {
    setCollapsed(value);
    onCollapsedChange?.(value);
  };

  return (
    <aside className={cn('h-full glass-sidebar transition-all duration-300', collapsed ? 'w-16' : 'w-64')}>
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center justify-between border-b border-foreground/5 px-4">
          {!collapsed && <span className="text-sm font-semibold tracking-tight">Dashboard Anibal</span>}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleCollapsed(!collapsed)}
            className="text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

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
                    ? 'bg-foreground/8 font-medium text-foreground'
                    : 'text-muted-foreground/80 hover:bg-foreground/5 hover:text-foreground',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-foreground/5 p-3">
          <div className={cn('flex', collapsed ? 'justify-center' : 'justify-end')}>
            <ThemeToggle collapsed={collapsed} />
          </div>
          {!collapsed && email && (
            <p className="mb-2 truncate px-3 text-xs text-muted-foreground/80">{email}</p>
          )}
          <Button
            variant="ghost"
            onClick={() => signOut()}
            className={cn(
              'w-full justify-start gap-3 rounded-lg text-muted-foreground/80 hover:bg-foreground/5 hover:text-foreground',
              collapsed && 'justify-center px-0',
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
