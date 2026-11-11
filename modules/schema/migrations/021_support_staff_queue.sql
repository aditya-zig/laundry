-- Staff queue is global to authorized support roles, unlike the existing
-- customer-prefixed index. Keep keyset reads ordered/bounded without rewriting
-- historical migrations, customer ownership, case state or message content.
CREATE INDEX IF NOT EXISTS support_v2_incident_staff_queue
  ON support_v2_incidents (created_at DESC, id DESC);
