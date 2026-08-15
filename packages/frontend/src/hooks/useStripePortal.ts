import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { openExternalWindow } from '@/lib/openExternalWindow';

export function useStripePortal() {
  return useMutation({
    mutationFn: async () => {
      const popup = openExternalWindow();
      try {
        const data = await api.post<{ url: string }>('/stripe/portal', {});
        popup.navigate(data.url);
        return data;
      } catch (err) {
        popup.close();
        throw err;
      }
    },
  });
}
