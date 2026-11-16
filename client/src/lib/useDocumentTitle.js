import { useEffect } from 'react';

export function useDocumentTitle(title) {
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = title;
  }, [title]);
}
