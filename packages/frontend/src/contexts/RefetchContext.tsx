import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface RefetchContextType {
  refetchSignal: number;
  triggerRefetch: () => void;
}

const RefetchContext = createContext<RefetchContextType | undefined>(undefined);

interface RefetchProviderProps {
  children: ReactNode;
}

export function RefetchProvider({ children }: RefetchProviderProps) {
  const [refetchSignal, setRefetchSignal] = useState(0);

  const triggerRefetch = useCallback(() => {
    setRefetchSignal((prev) => prev + 1);
  }, []);

  return (
    <RefetchContext.Provider value={{ refetchSignal, triggerRefetch }}>
      {children}
    </RefetchContext.Provider>
  );
}

export function useRefetch(): RefetchContextType {
  const context = useContext(RefetchContext);
  if (context === undefined) {
    throw new Error('useRefetch must be used within a RefetchProvider');
  }
  return context;
}
