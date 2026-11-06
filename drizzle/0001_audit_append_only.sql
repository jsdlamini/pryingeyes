-- Audit log is append-only. The only permitted change is nulling a payload
-- (erasure / retention); hashes and linkage can never be modified or deleted.
CREATE OR REPLACE FUNCTION audit_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_events is append-only';
  END IF;
  IF NEW.seq IS DISTINCT FROM OLD.seq OR NEW.at IS DISTINCT FROM OLD.at OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.subject_type IS DISTINCT FROM OLD.subject_type OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
     OR NEW.hash IS DISTINCT FROM OLD.hash OR NEW.payload IS NOT NULL THEN
    RAISE EXCEPTION 'audit_events rows are immutable (only payload erasure is allowed)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_guard_trg BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_guard();
