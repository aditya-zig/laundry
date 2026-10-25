import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { v2 } from "@laundry/contracts";
import { apiV2 } from "../src/api-v2";
import { getFoundation, getV2Client, onCustomerIdentityChange } from "../src/foundation/session";
import { createBooker, type BookResult } from "../src/features/booking/booking-flow";
import {
  buildBookingInput,
  buildQuoteInput,
  buildSlotQuery,
  nextSignInPrompt,
} from "../src/features/booking/checkout-flow";
import {
  formatDateLabel,
  formatTime,
  groupSlotPairs,
  pairPickupLabel,
  pairReturnLabel,
} from "../src/features/booking/schedule";
import { toRequestedLines, type BagLine } from "../src/features/booking/lines";
import { bagHeadline, describeError, dueAtReturnCopy } from "../src/features/booking/presenters";
import { bagStore } from "../src/features/booking/basket-store";
import { bagTotals, viewBagLines } from "../src/features/booking/view";
import { canConfirmBooking, formatINR, isQuoteExpired } from "../src/guards";
import { Card, Loading, NoteCard } from "../src/features/booking/ui";
import { AddressEditor } from "../src/features/booking/AddressEditor";
import { colors, minTouchTarget, radius, spacing } from "../src/theme";

// Product checkout. Sequence: public phone OTP sign-in (no prior session), an
// owned server address, a server slot pair (no typed ISO schedule), an
// explicit quote, and an explicit booking confirmation through the v2 SDK.
// Missing configuration or data renders as an actionable blocked screen; no
// demo fallback is ever substituted.

function ScreenShell(props: { children: ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {props.children}
    </ScrollView>
  );
}

type Access = { ok: true; foundation: ReturnType<typeof getFoundation> } | { ok: false; cause: unknown };

function resolveAccess(): Access {
  try {
    return { ok: true, foundation: getFoundation() };
  } catch (cause) {
    return { ok: false, cause };
  }
}

export default function Checkout() {
  const router = useRouter();
  const bag = bagStore();
  const lines = useSyncExternalStore(bag.subscribe, bag.getLines, bag.getLines);
  const [authEpoch, setAuthEpoch] = useState(0);
  useEffect(() => {
    try {
      return onCustomerIdentityChange(() => setAuthEpoch((epoch) => epoch + 1));
    } catch {
      return undefined;
    }
  }, []);

  const access = resolveAccess();
  if (!access.ok) {
    const message = access.cause instanceof Error ? access.cause.message : String(access.cause);
    return (
      <ScreenShell>
        <BackBar />
        <Text style={styles.title} accessibilityRole="header">
          Booking
        </Text>
        <NoteCard
          kind="blocked"
          title="This app build is not connected to the v2 API"
          body={`${message} Point the build at the v2 API address (EXPO_PUBLIC_API_V2_URL, https and path /v2) and rebuild — booking stays disabled until then.`}
        />
      </ScreenShell>
    );
  }

  const foundation = access.foundation;
  const snap = foundation.snapshot();

  if (snap.state === "restoreFailed") {
    return (
      <ScreenShell>
        <BackBar />
        <NoteCard
          kind="blocked"
          title="Sign-in could not be restored"
          body="A stored session was found but it is no longer usable. Close and reopen the app, or contact support if this keeps happening."
        />
      </ScreenShell>
    );
  }

  if (snap.state !== "authenticated") {
    return <SignInScreen />;
  }

  return <ArrangeScreen key={authEpoch} authEpoch={authEpoch} lines={lines} />;
}

function BackBar() {
  const router = useRouter();
  return (
    <View style={styles.backRow}>
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.backText}>Bag</Text>
      </Pressable>
    </View>
  );
}

function SignInScreen() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<v2.OtpChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  async function requestOtp() {
    const prompt = nextSignInPrompt(phone);
    if (prompt.step === "PHONE") {
      setSignInError(prompt.reason);
      return;
    }
    setBusy(true);
    setSignInError(null);
    try {
      // Public identity endpoint: needs no prior session.
      const issued = await getV2Client().requestOtp(phone.trim());
      setChallenge(issued);
    } catch (caught) {
      setChallenge(null);
      const detail = describeError(caught);
      setSignInError(`${detail.title}. ${detail.body}`);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    const clean = code.trim();
    if (!/^\d{6}$/.test(clean)) {
      setSignInError("Enter the 6-digit code.");
      return;
    }
    if (!challenge) return;
    setBusy(true);
    setSignInError(null);
    try {
      // Public verification; the returned session is adopted through the
      // shared foundation, and the identity listener advances the screen.
      await apiV2.verifyAndAdoptSession({ challengeId: challenge.challengeId, code: clean });
    } catch (caught) {
      const detail = describeError(caught);
      setSignInError(`${detail.title}. ${detail.body}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell>
      <BackBar />
      <Text style={styles.title} accessibilityRole="header">
        Sign in to book
      </Text>
      <Text style={styles.lede}>
        You pay when your clothes are returned. A verified phone number is required before booking a pickup.
      </Text>
      <Card title="Phone sign-in">
        <Text style={styles.fieldLabel}>Phone number</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+919876543210"
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          editable={challenge === null && !busy}
          accessibilityLabel="Phone number"
        />
        {challenge === null ? (
          <Pressable
            onPress={() => void requestOtp()}
            disabled={busy}
            style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Send one-time code"
          >
            <Text style={styles.primaryText}>{busy ? "Sending…" : "Send one-time code"}</Text>
          </Pressable>
        ) : null}

        {challenge !== null ? (
          <>
            <Text style={styles.fieldLabel}>6-digit code</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
              accessibilityLabel="One-time code"
            />
            <Text style={styles.finePrint}>
              The code arrives by SMS from the configured provider. If it does not arrive, wait a minute and request a new one. There is no demo code.
            </Text>
            <Pressable
              onPress={() => void verifyOtp()}
              disabled={busy}
              style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Verify code and continue"
            >
              <Text style={styles.primaryText}>{busy ? "Checking…" : "Verify and continue"}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setChallenge(null);
                setCode("");
                setSignInError(null);
              }}
              style={styles.linkButton}
              accessibilityRole="button"
              accessibilityLabel="Change phone number"
            >
              <Text style={styles.linkText}>Change phone number</Text>
            </Pressable>
          </>
        ) : null}

        {signInError ? <NoteCard kind="error" title={signInError} /> : null}
      </Card>
      <Text style={styles.finePrint}>
        Your session is held in app memory unless verified secure platform storage is injected into this build. Nothing here claims durable persistence.
      </Text>
    </ScreenShell>
  );
}

function ArrangeScreen(props: { authEpoch: number; lines: BagLine[] }) {
  const router = useRouter();
  const bag = bagStore();
  const { authEpoch, lines } = props;
  const [services, setServices] = useState<v2.Service[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [queueReady, setQueueReady] = useState(false);
  const [addresses, setAddresses] = useState<v2.Address[] | null>(null);
  const [addressError, setAddressError] = useState<unknown>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [area, setArea] = useState<v2.ServiceArea | null>(null);
  const [areaError, setAreaError] = useState<unknown>(null);
  const [pairs, setPairs] = useState<v2.SlotPair[] | null>(null);
  const [pairsError, setPairsError] = useState<unknown>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [pairId, setPairId] = useState<string | null>(null);
  const [quote, setQuote] = useState<v2.Quote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [result, setResult] = useState<
    { phase: "order"; order: v2.Order } | { phase: "unknown" } | { phase: "failed"; error: unknown } | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const bookRef = useRef<ReturnType<typeof createBooker> | null>(null);
  if (bookRef.current === null) bookRef.current = createBooker((input) => apiV2.bookOrderDurable(input));

  const loadCustomerData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setAddressError(null);
    setQueueReady(false);
    try {
      const [servicesSettled, addressesSettled, queuedSettled] = await Promise.allSettled([
        getV2Client().listServices(),
        getFoundation().authorized((client) => client.listAddresses()),
        getFoundation().listQueuedMutations(),
      ]);
      if (queuedSettled.status === "rejected") {
        setLoadError(queuedSettled.reason);
      } else {
        try {
          const pending = queuedSettled.value.find(record => record.routeId === "orders.book");
          if (pending && !bookRef.current!.pendingInput()) {
            const input = v2.bookingInputSchema.parse(JSON.parse(pending.bodyJson ?? "null"));
            bookRef.current = createBooker(value => apiV2.bookOrderDurable(value), input);
            setResult({ phase: "unknown" });
          }
          setQueueReady(true);
        } catch (error) { setLoadError(error); }
      }
      if (servicesSettled.status === "rejected") {
        setServices([]);
        setLoadError(servicesSettled.reason);
      } else {
        setServices(servicesSettled.value);
      }
      if (addressesSettled.status === "rejected") {
        setAddresses([]);
        setAddressError(addressesSettled.reason);
      } else {
        setAddresses(addressesSettled.value);
        setAddressId((current) => current ?? addressesSettled.value[0]?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomerData();
  }, [loadCustomerData, authEpoch]);

  // Coverage follows the selected owned address; the server decides.
  useEffect(() => {
    setArea(null);
    setAreaError(null);
    setPairs(null);
    setPairId(null);
    setQuote(null);
    if (!addressId) return;
    const address = addresses?.find((candidate) => candidate.id === addressId);
    if (!address) return;
    let active = true;
    getV2Client()
      .checkServiceArea(address.postalCode)
      .then((found) => {
        if (active) {
          setArea(found);
          setAreaError(null);
        }
      })
      .catch((caught) => {
        if (active) {
          setArea(null);
          setAreaError(caught);
        }
      });
    return () => {
      active = false;
    };
  }, [addressId, addresses]);

  // Server slot pairs only; the bag's services define the query.
  useEffect(() => {
    if (!area || !services) return;
    let active = true;
    setSlotsLoading(true);
    setPairsError(null);
    setPairId(null);
    setPairs(null);
    setQuote(null);
    (async () => {
      try {
        // Stale bag lines must not invent a service query; only valid lines
        // define which services to search.
        const requested = toRequestedLines(lines, services);
        const query = buildSlotQuery({ areaId: area.id, now: new Date(), serviceIds: requested.lines.map((line) => line.serviceId) });
        const fetched = await getV2Client().listSlots(query);
        if (active) setPairs(fetched);
      } catch (caught) {
        if (active) {
          setPairs([]);
          setPairsError(caught);
        }
      } finally {
        if (active) setSlotsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [area, services, lines]);

  const rows = services ? viewBagLines(lines, services) : lines.map((line) => ({ line, status: "ok" as const }));
  const validLinesResult = services ? toRequestedLines(lines, services) : { lines: [], invalid: [] };
  const validLineCount = validLinesResult.lines.length;
  const invalidLineCount = validLinesResult.invalid.length;
  const selectedPair = pairs?.find((pair) => pair.id === pairId) ?? null;
  const address = addresses?.find((candidate) => candidate.id === addressId) ?? null;

  async function requestQuote() {
    if (!queueReady || bookRef.current!.pendingInput() || !selectedPair || !address || !services) return;
    setQuoteBusy(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const requested = toRequestedLines(lines, services);
      if (requested.lines.length === 0) {
        setQuoteError(new Error("Every bag line is out of date. Remove them and add current services."));
        return;
      }
      const input = buildQuoteInput({
        addressId: address.id,
        pair: selectedPair,
        lines: requested.lines,
        timezone: area?.timezone ?? "Asia/Kolkata",
      });
      // Retained quote/version: the same request retried keeps one key.
      setQuote(await apiV2.quote(input));
    } catch (caught) {
      setQuoteError(caught);
    } finally {
      setQuoteBusy(false);
    }
  }

  async function confirmBooking() {
    // An unknown original outcome must still be reconciled with its original
    // key after the displayed terms expire; a cached booking may already exist.
    const pending = bookRef.current!.pendingInput();
    if (!pending && (!queueReady || !quote || !canConfirmBooking(quote.expiresAt, false))) return;
    setConfirmBusy(true);
    try {
      // Reconcile the retained original, even after navigation or bag changes.
      const outcome = await bookRef.current!.attempt(pending ? undefined : buildBookingInput(quote!));
      if (outcome === null) return; // A confirmation is already in flight.
      if (outcome.phase === "booked") {
        setResult({ phase: "order", order: outcome.order });
        bag.clear();
      } else if (outcome.phase === "unknown") {
        setResult({ phase: "unknown" });
      } else {
        setResult({ phase: "failed", error: outcome.error });
      }
    } finally {
      setConfirmBusy(false);
    }
  }

  const quoteStale = quote !== null && isQuoteExpired(quote.expiresAt);
  const tz = area?.timezone ?? "Asia/Kolkata";

  return (
    <ScreenShell>
      <BackBar />
      <Text style={styles.title} accessibilityRole="header">
        Booking
      </Text>
      <Text style={styles.lede}>{bagHeadline(bagTotals(rows).units)}</Text>

      {loading ? <Loading label="Loading your details" /> : null}
      {loadError !== null ? (
        <NoteCard kind="error" title={describeError(loadError).title} body={describeError(loadError).body} actionLabel="Retry" onAction={() => void loadCustomerData()} />
      ) : null}

      {lines.length > 0 ? (
        <Text style={styles.bagSummaryLines}>
          {lines.length} bag line{lines.length === 1 ? "" : "s"}
          {invalidLineCount > 0 ? ` · ${invalidLineCount} stale line${invalidLineCount === 1 ? "" : "s"} excluded from the quote` : ""}
        </Text>
      ) : null}

      {lines.length === 0 && result === null ? (
        <NoteCard
          kind="blocked"
          title="Your bag is empty"
          body="Add services before booking. The bag is not sent anywhere until you confirm an explicit booking."
          actionLabel="Browse services"
          onAction={() => router.push("/")}
        />
      ) : null}

      {result !== null ? (
        <BookingResultCard
          result={result}
          onNewAttempt={() => {
            setResult(null);
            setQuote(null);
          }}
          onUnknownRetry={() => void confirmBooking()}
        />
      ) : queueReady ? (
        <>
          {lines.length > 0 ? (
            <>
              <Card title="1. Pickup address">
                {addressError !== null ? (
                  <NoteCard kind="error" title={describeError(addressError).title} body={describeError(addressError).body} actionLabel="Retry" onAction={() => void loadCustomerData()} />
                ) : null}
                {addresses !== null && addresses.length === 0 && addressError === null ? (
                  <NoteCard
                    kind="blocked"
                    title="No saved address yet"
                    body="Save your own pickup address below. Coverage and capacity are checked separately by the server."
                  />
                ) : null}
                {addingAddress || addresses?.length === 0 ? <AddressEditor onSaved={saved => {
                  setAddresses(current => [...(current ?? []).filter(address => address.id !== saved.id), saved]);
                  setAddressId(saved.id); setAddingAddress(false);
                }} /> : <NoteCard kind="note" title="Another pickup address?" actionLabel="Add an address" onAction={() => setAddingAddress(true)} />}
                {(addresses ?? []).map((candidate) => (
                  <Pressable
                    key={candidate.id}
                    onPress={() => {
                      setAddressId(candidate.id);
                      setQuote(null);
                      setPairId(null);
                    }}
                    style={({ pressed }) => [styles.choice, addressId === candidate.id && styles.choiceSelected, pressed && styles.pressed]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: addressId === candidate.id }}
                    accessibilityLabel={`Use address ${candidate.label}`}
                  >
                    <Text style={styles.choiceTitle}>{candidate.label}</Text>
                    <Text style={styles.choiceBody}>
                      {candidate.line1}, {candidate.city} {candidate.postalCode}
                    </Text>
                  </Pressable>
                ))}
              </Card>

              {addressId !== null ? (
                <Card title="2. Pickup time">
                  <SlotBody area={area} areaError={areaError} pairs={pairs} pairsError={pairsError} slotsLoading={slotsLoading} pairId={pairId} timezone={tz} onPick={(id) => { setPairId(id); setQuote(null); }} />
                </Card>
              ) : null}

              <Card title="3. Server quote">
                <Text style={styles.finePrint}>
                  The price and the return promise come only from the explicit quote below. Nothing is estimated on this screen.
                </Text>
                <Pressable
                  onPress={() => void requestQuote()}
                  disabled={quoteBusy || selectedPair === null || validLineCount === 0}
                  style={({ pressed }) => [styles.primary, (quoteBusy || selectedPair === null || validLineCount === 0) && styles.disabled, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={quote ? "Request fresh terms" : "Request quote"}
                >
                  <Text style={styles.primaryText}>
                    {quote ? "Request fresh terms" : quoteBusy ? "Pricing…" : "Request quote"}
                  </Text>
                </Pressable>
                {selectedPair === null && pairs !== null && (pairs?.length ?? 0) > 0 ? (
                  <Text style={styles.finePrint}>Pick a published pickup time first.</Text>
                ) : null}

                {quoteError !== null ? <NoteCard kind="error" title={describeError(quoteError).title} body={describeError(quoteError).body} /> : null}

                {quote ? (
                  <View style={styles.quoteCard}>
                    <View style={styles.quoteHead}>
                      <Text style={styles.quoteTotal}>{formatINR(quote.totalMinor)}</Text>
                      <View style={quote.provisional ? styles.pillWarning : styles.pillSuccess}>
                        <Text style={styles.pillText}>{quote.provisional ? "PROVISIONAL" : "FIXED"}</Text>
                      </View>
                    </View>
                    {quote.breakdown.map((component, index) => (
                      <View key={`${component.kind}-${component.label}-${index}`} style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>{component.label}</Text>
                        <Text style={styles.breakdownValue}>{formatINR(component.amountMinor)}</Text>
                      </View>
                    ))}
                    <Text style={styles.quoteMeta}>
                      Pickup {formatTime(quote.pickupWindow.start, tz)}–{formatTime(quote.pickupWindow.end, tz)} · Return by{" "}
                      {formatTime(quote.promisedReturnWindow.end, tz)}
                    </Text>
                    <Text style={styles.quoteMeta}>
                      Terms valid until {formatTime(quote.expiresAt, tz)}. Server time governs expiry; the quoted version is retained at booking.
                    </Text>
                    <Pressable
                      onPress={() => void confirmBooking()}
                      disabled={confirmBusy || quoteStale}
                      style={({ pressed }) => [styles.primary, (confirmBusy || quoteStale) && styles.disabled, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Confirm booking"
                    >
                      <Text style={styles.primaryText}>{confirmBusy ? "Confirming…" : "Confirm booking · pay at return"}</Text>
                    </Pressable>
                    {quoteStale ? (
                      <NoteCard kind="warning" title="This quote expired" body="Request fresh terms to continue. Your bag keeps its lines." />
                    ) : null}
                  </View>
                ) : null}
              </Card>

              <Text style={styles.finePrint}>
                Booking retries reuse the same idempotency key, so a double tap or timeout cannot create two orders. Unconfirmed intents live in process memory unless verified native stores are injected; this build makes no durability claim.
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </ScreenShell>
  );
}

function SlotBody(props: {
  area: v2.ServiceArea | null;
  areaError: unknown;
  pairs: v2.SlotPair[] | null;
  pairsError: unknown;
  slotsLoading: boolean;
  pairId: string | null;
  timezone: string;
  onPick: (pairId: string) => void;
}) {
  if (props.areaError !== null) {
    const outside = props.areaError instanceof Error && props.areaError.message.startsWith("NOT_FOUND");
    const copy = describeError(props.areaError);
    return (
      <NoteCard
        kind="blocked"
        title={outside ? "Outside the service area" : copy.title}
        body={outside ? "The post code of this address has no server service area yet. Booking stays disabled until the operator serves it." : copy.body}
      />
    );
  }
  if (!props.area) return <Loading label="Checking the service area" />;

  const groups = props.pairs && props.pairs.length > 0 ? groupSlotPairs(props.pairs, props.timezone) : [];
  return (
    <View>
      <Text style={styles.finePrint}>Only pickup and return pairs published by the server appear here. Unavailable entries stay visible with their reason.</Text>
      {props.slotsLoading ? <Loading label="Loading published pickup times" /> : null}
      {props.pairsError !== null ? (
        <NoteCard kind="error" title={describeError(props.pairsError).title} body={describeError(props.pairsError).body} />
      ) : null}
      {props.pairs !== null && props.pairs.length === 0 && !props.slotsLoading ? (
        <NoteCard
          kind="blocked"
          title="No pickup slots published"
          body={`The server has no pickup and return pairs for the next 7 days in ${props.area.name}.`}
        />
      ) : null}
      {groups.map((group) => (
        <View key={group.localDate} style={styles.dayGroup}>
          <Text style={styles.dayLabel}>{formatDateLabel(group.pairs[0].pickupWindow.start, props.timezone)}</Text>
          {group.pairs.map((pair) => {
            const selected = props.pairId === pair.id;
            return (
              <Pressable
                key={pair.id}
                onPress={() => (pair.available ? props.onPick(pair.id) : undefined)}
                disabled={!pair.available}
                style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, !pair.available && styles.choiceDisabled, pressed && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: !pair.available }}
                accessibilityLabel={
                  pair.available
                    ? `Pickup ${pairPickupLabel(pair, props.timezone)}`
                    : `${pairPickupLabel(pair, props.timezone)} unavailable`
                }
              >
                <Text style={styles.choiceTitle}>{pairPickupLabel(pair, props.timezone)}</Text>
                <Text style={styles.choiceBody}>{pair.available ? pairReturnLabel(pair, props.timezone) : unavailableCopy(pair.unavailableReason)}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function unavailableCopy(reason: v2.SlotPair["unavailableReason"]): string {
  switch (reason) {
    case "NO_CAPACITY":
      return "Fully booked";
    case "DEADLINE_UNAVAILABLE":
      return "Too late for this return promise";
    case "CLOSED":
      return "Closed";
    default:
      return "Unavailable";
  }
}

function BookingResultCard(props: {
  result: { phase: "order"; order: v2.Order } | { phase: "unknown" } | { phase: "failed"; error: unknown };
  onNewAttempt: () => void;
  onUnknownRetry: () => void;
}) {
  const router = useRouter();
  if (props.result.phase === "order") {
    const order = props.result.order;
    return (
      <Card title="Booking">
        <Text style={styles.confirmTitle}>Booking confirmed</Text>
        <Text style={styles.confirmBody}>{dueAtReturnCopy(order)}</Text>
        <Text style={styles.orderId} accessibilityLabel={`Order identifier ${order.id}`}>
          {order.id}
        </Text>
        <Text style={styles.quoteMeta}>
          Status {order.status}. The quoted pickup window and return promise stand until operations reschedule them.
        </Text>
        <Text style={styles.finePrint}>
          Your bag was cleared only after this confirmation. The order record and recorded history are available below.
        </Text>
        <NoteCard kind="note" title="Your order record" actionLabel="View order" onAction={() => router.push({ pathname: "/orders/[id]", params: { id: order.id } })} />
      </Card>
    );
  }
  if (props.result.phase === "unknown") {
    return (
      <NoteCard
        kind="warning"
        title="We could not confirm what happened"
        body="The server may hold your booking. Check the same request below; do not start another booking. Keep this session open: pending requests in this build do not survive a reload. After signing back in, check Orders before creating another booking."
        actionLabel="Check booking again"
        onAction={props.onUnknownRetry}
      />
    );
  }
  const copy = describeError(props.result.error);
  return (
    <NoteCard
      kind="error"
      title={copy.title}
      body={copy.body}
      actionLabel="Start booking again"
      onAction={props.onNewAttempt}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  content: { padding: spacing.md, paddingBottom: 64, maxWidth: 560, width: "100%", alignSelf: "center" },
  backRow: { marginBottom: 4 },
  back: { minHeight: minTouchTarget, justifyContent: "center" },
  backText: { color: colors.action, fontSize: 15, fontWeight: "700" },
  title: { color: colors.ink, fontSize: 26, fontWeight: "700" },
  lede: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, marginTop: 6 },
  bagSummaryLines: { color: colors.inkMuted, fontSize: 13, marginTop: 6 },
  fieldLabel: { color: colors.ink, fontSize: 14, fontWeight: "600", marginTop: 10 },
  input: {
    color: colors.ink,
    backgroundColor: colors.surfaceCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    fontSize: 16,
    paddingHorizontal: 12,
    minHeight: minTouchTarget,
    marginTop: 6,
  },
  primary: { backgroundColor: colors.action, minHeight: minTouchTarget, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 14 },
  pressed: { backgroundColor: colors.actionPressed },
  disabled: { opacity: 0.5 },
  primaryText: { color: colors.surface, fontSize: 15, fontWeight: "700" },
  linkButton: { minHeight: minTouchTarget, alignItems: "center", justifyContent: "center", marginTop: 6 },
  linkText: { color: colors.action, fontWeight: "700", fontSize: 14 },
  finePrint: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    minHeight: minTouchTarget,
    marginTop: 10,
    justifyContent: "center",
  },
  choiceSelected: { borderColor: colors.action, borderWidth: 2, backgroundColor: colors.actionSoft },
  choiceDisabled: { opacity: 0.6 },
  choiceTitle: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  choiceBody: { color: colors.inkMuted, fontSize: 13, marginTop: 2 },
  dayGroup: { marginTop: 12 },
  dayLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  quoteCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceCard, padding: spacing.md, marginTop: 14 },
  quoteHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  quoteTotal: { color: colors.ink, fontSize: 20, fontWeight: "800" },
  pillWarning: { backgroundColor: colors.warningSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillSuccess: { backgroundColor: colors.successSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  breakdownLabel: { color: colors.inkMuted, fontSize: 14, flex: 1 },
  breakdownValue: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  quoteMeta: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  confirmTitle: { color: colors.success, fontSize: 18, fontWeight: "800" },
  confirmBody: { color: colors.ink, fontSize: 15, lineHeight: 22, marginTop: 6 },
  orderId: { color: colors.ink, fontSize: 13, fontFamily: "monospace", marginTop: 8 },
});
