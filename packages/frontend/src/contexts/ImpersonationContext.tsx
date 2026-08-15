import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';

interface ImpersonationTarget {
  userId: string;
  userName: string;
}

interface ImpersonationContextType {
  target: ImpersonationTarget | null;
  isImpersonating: boolean;
  startImpersonation: (userId: string, userName: string) => void;
  stopImpersonation: () => void;
  /** Returns the impersonated user ID if impersonating, otherwise the real user ID */
  getEffectiveUserId: (realUserId: string | undefined) => string | undefined;
}

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined);

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ImpersonationTarget | null>(null);

  const startImpersonation = useCallback((userId: string, userName: string) => {
    setTarget({ userId, userName });
  }, []);

  const stopImpersonation = useCallback(() => {
    setTarget(null);
  }, []);

  const getEffectiveUserId = useCallback(
    (realUserId: string | undefined) => {
      return target?.userId ?? realUserId;
    },
    [target]
  );

  return (
    <ImpersonationContext.Provider
      value={{ target, isImpersonating: !!target, startImpersonation, stopImpersonation, getEffectiveUserId }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) throw new Error('useImpersonation must be used within ImpersonationProvider');
  return ctx;
}
