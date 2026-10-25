import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { isMutationOutcomePending } from "@laundry/app-foundation";
import type { v2 } from "@laundry/contracts";
import { getFoundation } from "../../foundation/session";
import { colors, minTouchTarget, spacing } from "../../theme";
import { addressFromFields, type AddressFields } from "./address-form";
import { describeError } from "./presenters";
import { NoteCard } from "./ui";

const labels: Array<[keyof AddressFields, string]> = [["label", "Address label"], ["line1", "Street and building"], ["city", "City"], ["postalCode", "Six-digit PIN code"], ["latitude", "Pickup latitude"], ["longitude", "Pickup longitude"]];
export function AddressEditor({ onSaved }: { onSaved: (address: v2.Address) => void }) {
  const [fields, setFields] = useState<AddressFields>({ label: "", line1: "", city: "", postalCode: "", latitude: "", longitude: "" });
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true), sending = useRef(false), retained = useRef<v2.AddressInput | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function locate() {
    if (locating || busy || uncertain) return;
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) { setNotice("Device location is unavailable here. Enter the pickup coordinates manually; no location is guessed."); return; }
    setLocating(true); setNotice(null);
    geolocation.getCurrentPosition(position => {
      if (!mounted.current) return;
      if (!retained.current) setFields(value => ({ ...value, latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) }));
      setLocating(false);
      setNotice("Check that the device position is the actual pickup address before saving.");
    }, () => {
      if (!mounted.current) return;
      setLocating(false); setNotice("Location permission or positioning failed. Enter the pickup coordinates manually, or allow location and retry.");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }
  async function save() {
    if (sending.current) return;
    let input: v2.AddressInput;
    try { input = retained.current ?? addressFromFields(fields); }
    catch { setNotice("Enter all address fields, a six-digit PIN and valid latitude (-90 to 90) and longitude (-180 to 180)."); return; }
    sending.current = true; retained.current = input; setBusy(true); setNotice(null);
    try {
      const address = await getFoundation().enqueueMutation({ routeId: "identity.address.create", body: input });
      if (mounted.current) onSaved(address);
    } catch (error) {
      if (!mounted.current) return;
      const pending = isMutationOutcomePending(error);
      setUncertain(pending);
      if (!pending) retained.current = null;
      setNotice(pending ? "The save outcome is unconfirmed. Retry the same address below; do not create a replacement." : describeError(error).body);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <View>
    <Text style={{ color: colors.inkMuted, marginTop: spacing.md }}>Use the actual pickup location. Service availability is checked by the server after saving; saving an address does not guarantee coverage.</Text>
    {labels.map(([key, label]) => <View key={key} style={{ marginTop: spacing.md }}>
      <Text style={{ color: colors.ink }}>{label}</Text>
      <TextInput accessibilityLabel={label} value={fields[key]} editable={!busy && !uncertain} onChangeText={value => setFields(current => ({ ...current, [key]: value }))} keyboardType={key === "postalCode" ? "number-pad" : "default"} autoCapitalize="none" style={{ color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minHeight: minTouchTarget, padding: 10, marginTop: 4, borderRadius: 8 }} />
    </View>)}
    <Pressable accessibilityRole="button" disabled={busy || uncertain || locating} onPress={locate} style={{ minHeight: minTouchTarget, justifyContent: "center", marginTop: spacing.md }}><Text style={{ color: colors.action }}>{locating ? "Locating…" : "Use device location"}</Text></Pressable>
    {notice ? <NoteCard kind="warning" title="Address status" body={notice} /> : null}
    <Pressable accessibilityRole="button" disabled={busy || locating} onPress={() => void save()} style={{ minHeight: minTouchTarget, justifyContent: "center", alignItems: "center", backgroundColor: colors.action, borderRadius: 8, marginTop: spacing.md, opacity: busy || locating ? 0.5 : 1 }}><Text style={{ color: colors.surface, fontWeight: "700" }}>{busy ? "Saving…" : uncertain ? "Retry original address save" : "Save pickup address"}</Text></Pressable>
  </View>;
}
