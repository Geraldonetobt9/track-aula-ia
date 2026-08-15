type ExternalWindow = {
  navigate: (url: string) => void;
  close: () => void;
};

export function openExternalWindow(): ExternalWindow {
  const popup = window.open('about:blank', '_blank');
  if (popup) {
    try {
      popup.opener = null;
    } catch {
      // Cross-origin assignment may throw — ignore.
    }
  }
  return {
    navigate: (url) => {
      if (popup && !popup.closed) {
        popup.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    close: () => {
      if (popup && !popup.closed) popup.close();
    },
  };
}
