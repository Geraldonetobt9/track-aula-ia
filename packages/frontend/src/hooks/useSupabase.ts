import { api } from '@/lib/api';

/**
 * @deprecated This hook is no longer needed. Import `api` from `@/lib/api` directly.
 * Kept temporarily for backward compatibility during migration.
 */
export function useSupabase() {
  return api;
}
