-- Allow a requester to cancel a pending project access request.
-- Widen the status CHECK (migration 003) to include CANCELLED. Discover and
-- drop any existing status check on access_requests so a renamed constraint
-- cannot leave the old, narrower check in force. Atomic.
BEGIN;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'access_requests'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE access_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE access_requests ADD CONSTRAINT access_requests_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED'));

COMMIT;
