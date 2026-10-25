import { useEffect, useState } from "react";

export interface SyncSource<T> {
  getState: () => T;
  subscribe: (listener: () => void) => () => void;
}

/** Sync a framework-free controller into React; effects only run client-side,
 * so server rendering shows the controller's current snapshot verbatim. */
export function useSyncedState<T>(source: SyncSource<T> | null | undefined): T | undefined {
  const [snapshot, setSnapshot] = useState<T | undefined>(() => source?.getState());
  useEffect(() => {
    if (!source) return;
    setSnapshot(source.getState());
    return source.subscribe(() => setSnapshot(source.getState()));
  }, [source]);
  return snapshot;
}
