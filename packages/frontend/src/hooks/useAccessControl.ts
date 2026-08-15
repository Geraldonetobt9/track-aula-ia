import { useMemo } from 'react';
import { User } from '@/contexts/AuthContext';

export function useAccessControl(user: User | null) {
  return useMemo(() => {
    if (!user) return { hasAccess: false, isExpired: false };

    // Admin always has access
    if (user.role === 'admin') return { hasAccess: true, isExpired: false };

    // If user is explicitly inactive, block access
    if (!user.active) return { hasAccess: false, isExpired: true };

    // Active users: also check subscription_end
    if (user.subscription_end) {
      const now = new Date();
      const end = new Date(user.subscription_end);
      if (end <= now) {
        return { hasAccess: false, isExpired: true };
      }
    }

    return { hasAccess: true, isExpired: false };
  }, [user]);
}
