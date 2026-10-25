import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import { getFoundation, partnerCacheEpoch, onPartnerIdentityChange } from "../../foundation/session";
import type { Actor } from "@laundry/api-client";

export type PartnerSessionView =
  | { state: "LOADING" }
  | { state: "CONFIG_ERROR"; message: string }
  | { state: "RESTORE_FAILED"; message: string }
  | { state: "SIGNED_OUT" }
  | { state: "AUTHENTICATED"; actor: Actor };

const stateViews = {
  loading: { state: "LOADING" } as PartnerSessionView,
  signedOut: { state: "SIGNED_OUT" } as PartnerSessionView,
};

function partnerView(): PartnerSessionView {
  const foundation = getFoundation();
  const snapshot = foundation.snapshot();
  if (snapshot.state === "authenticated") {
    const actor = foundation.getActor();
    return actor ? { state: "AUTHENTICATED", actor } : { state: "SIGNED_OUT" };
  }
  if (snapshot.state === "restoreFailed") {
    const cause = snapshot.cause instanceof Error ? snapshot.cause.message : String(snapshot.cause);
    return { state: "RESTORE_FAILED", message: cause };
  }
  return stateViews.signedOut;
}

let initPromise: Promise<void> | null = null;

async function initializeFoundation(): Promise<void> {
  initPromise ||= getFoundation()
    .initialize()
    .then(() => undefined)
    .catch(() => undefined);
  await initPromise;
}

export function usePartnerSession(): PartnerSessionView & { identityEpoch: number; refresh: () => void; reload: () => Promise<void> } {
  const [epoch, setEpoch] = useState(() => ({ local: 0, shared: partnerCacheEpoch() }));

  const refresh = useCallback(() => {
    setEpoch(next => ({ local: next.local + 1, shared: partnerCacheEpoch() }));
  }, []);

  const reload = useCallback(async () => {
    try { await initializeFoundation(); }
    catch { /* The view renders the explicit configuration/restore error. */ }
    finally { refresh(); }
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = onPartnerIdentityChange(refresh);
    return () => { unsubscribe(); };
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const view = useMemo<PartnerSessionView>(() => {
    try {
      void reload;
      return partnerView();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { state: "CONFIG_ERROR", message };
    }
  }, [epoch, reload]);

  return { ...view, identityEpoch: epoch.shared, refresh, reload };
}
