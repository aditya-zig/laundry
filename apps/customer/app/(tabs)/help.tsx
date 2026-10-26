import { useRouter } from "expo-router";
import { Page, NoteCard } from "../../src/features/booking/ui";

export default function Help() {
  const router = useRouter();
  return <Page title="Help">
    <NoteCard kind="note" title="Booking confirmation" body="Build your bag, sign in, select a saved address and choose a server-published pickup window. Review the quote and explicitly confirm. An unknown response is not a confirmed booking: retry the retained intent rather than creating a second booking." />
    <NoteCard kind="note" title="Order records" body="Your orders screen reads confirmed records and their recorded history. Scheduled times are promises, not proof that a rider has picked up or delivered a bag. Payment and delivery are separate records." />
    <NoteCard kind="note" title="Support for an order" body="Open an owned order to record a support case and read or send messages. A case does not change delivery status, reopen a completed order or promise a refund. Photos, automatic SMS/WhatsApp notifications and conversational booking are not connected here; no response-time guarantee is configured." actionLabel="View my orders" onAction={() => router.push('/(tabs)/orders')} />
  </Page>;
}
