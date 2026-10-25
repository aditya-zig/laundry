import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { getFoundation, onCustomerIdentityChange } from "../../foundation/session";
import { NoteCard } from "./ui";

/** Remount private children on identity/scope change; never retain another actor's view. */
export function CustomerPrivateScreen({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [epoch, setEpoch] = useState(0);
  useEffect(() => onCustomerIdentityChange(() => setEpoch(value => value + 1)), []);
  try {
    const snapshot = getFoundation().snapshot();
    if (snapshot.state !== "authenticated") {
      return <NoteCard kind="blocked" title="Sign in to continue" body="Use the verified phone sign-in flow. No demo account is substituted." actionLabel="Sign in" onAction={() => router.push("/checkout")} />;
    }
    if (snapshot.actor.role !== "CUSTOMER") {
      return <NoteCard kind="blocked" title="Customer account required" body="Staff access belongs in the staff app. This session cannot book or view customer orders." />;
    }
    return <Fragment key={`${snapshot.actor.id}:${epoch}`}>{children}</Fragment>;
  } catch (error) {
    return <NoteCard kind="blocked" title="Customer API is not configured" body={error instanceof Error ? error.message : "Configure the v2 API URL and rebuild."} />;
  }
}
