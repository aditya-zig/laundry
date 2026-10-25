import { Page, NoteCard } from "../../src/features/booking/ui";

export default function Help() {
  return <Page title="Help">
    <NoteCard kind="note" title="Booking confirmation" body="Build your bag, sign in, select a saved address and choose a server-published pickup window. Review the quote and explicitly confirm. An unknown response is not a confirmed booking: retry the retained intent rather than creating a second booking." />
    <NoteCard kind="note" title="Order records" body="Your orders screen reads confirmed records and their recorded history. Scheduled times are promises, not proof that a rider has picked up or delivered a bag. Payment and delivery are separate records." />
    <NoteCard kind="blocked" title="Support messaging is not connected here" body="This screen cannot currently open an incident, upload evidence or promise a refund. No chatbot, automatic resolution or messaging delivery is simulated. In-app support and conversational booking remain unfinished." />
  </Page>;
}
