-- Pilot windows and handover-code expiry.
--
-- Orders created before this migration carry only pickupStart/returnStart and a
-- six digit code with no expiry. Backfill the full window from the reserved
-- slot and give each code the same 12 hour grace the runtime issues now. The
-- statement is idempotent: initializeDb runs every migration on every start.

UPDATE pilot_orders o
SET data = o.data || jsonb_build_object(
  'timeZone', 'Asia/Kolkata',
  'pickupEnd', to_char(s.pickup_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'returnEnd', to_char(s.return_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'pickupCodeExpiresAt', to_char((s.pickup_end + interval '12 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'returnCodeExpiresAt', to_char((s.return_end + interval '12 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
FROM pilot_slots s
WHERE s.id = o.slot_id
  AND (
    o.data->>'timeZone' IS NULL
    OR o.data->>'pickupEnd' IS NULL
    OR o.data->>'returnEnd' IS NULL
    OR o.data->>'pickupCodeExpiresAt' IS NULL
    OR o.data->>'returnCodeExpiresAt' IS NULL
  );
