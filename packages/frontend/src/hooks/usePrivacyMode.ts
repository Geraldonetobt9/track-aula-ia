import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sentinel_dashboard_privacy';

export function usePrivacyMode() {
  const [isHidden, setIsHidden] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, isHidden ? 'true' : 'false');
  }, [isHidden]);

  const toggle = useCallback(() => setIsHidden((prev) => !prev), []);

  return { isHidden, toggle };
}
