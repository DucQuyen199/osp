import { useCallback, useEffect, useRef } from 'react';

/** Returns a guard for async work so only the newest request may update component state. */
export function useLatestRequest() {
  const sequence = useRef(0);

  useEffect(() => () => { sequence.current += 1; }, []);

  return useCallback(() => {
    const requestId = ++sequence.current;
    return () => sequence.current === requestId;
  }, []);
}
