import { useState } from "react";
import { logoutNotice } from "@laundry/app-foundation";
import { Text } from "react-native";
import { apiV2, getFoundation } from "../../src/api-v2";
import { CustomerPrivateScreen } from "../../src/features/booking/CustomerPrivateScreen";
import { bagStore } from "../../src/features/booking/basket-store";
import { Card, NoteCard, Page } from "../../src/features/booking/ui";
import { colors } from "../../src/theme";

export default function Account() {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const report = await apiV2.logout();
      bagStore().clear();
      setNotice(logoutNotice(report));
    } catch {
      setNotice("Sign-out could not be completed. Do not assume server sessions were revoked.");
    } finally { setBusy(false); }
  }
  return <Page title="Account">
    <CustomerPrivateScreen><AccountIdentity /></CustomerPrivateScreen>
    <NoteCard kind="note" title="Session storage" body="This build keeps browser credentials in memory. Native secure storage and device acceptance are not complete. Signing in is not proof that ordering is enabled." actionLabel={busy ? "Signing out…" : "Sign out"} actionDisabled={busy} onAction={() => void signOut()} />
    {notice ? <NoteCard kind="note" title="Sign-out result" body={notice} /> : null}
  </Page>;
}
function AccountIdentity() {
  const actor = getFoundation().getActor();
  return <Card title="Verified session"><Text style={{ color: colors.ink, marginTop: 8 }}>Account {actor?.id}</Text><Text style={{ color: colors.inkMuted, marginTop: 8 }}>Add pickup addresses from checkout. Editing and deleting saved addresses on this screen are not connected yet.</Text></Card>;
}
