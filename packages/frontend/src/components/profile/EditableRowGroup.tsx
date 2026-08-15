import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

type Ctx = {
  openId: string | null;
  setOpen: (id: string, open: boolean) => void;
};

const EditableRowContext = createContext<Ctx | null>(null);

export function EditableRowGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const setOpen = useCallback((id: string, open: boolean) => {
    setOpenId((current) => {
      if (open) return id;
      return current === id ? null : current;
    });
  }, []);

  const value = useMemo(() => ({ openId, setOpen }), [openId, setOpen]);

  return <EditableRowContext.Provider value={value}>{children}</EditableRowContext.Provider>;
}

export function useEditableRowControl(id: string | undefined) {
  const ctx = useContext(EditableRowContext);
  if (!ctx || !id) return null;
  return {
    editing: ctx.openId === id,
    setEditing: (open: boolean) => ctx.setOpen(id, open),
  };
}
