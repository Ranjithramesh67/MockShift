-- Allow a requester to cancel a pending project access request.
-- The original CHECK only permitted PENDING/APPROVED/DENIED (migration 003).
ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS access_requests_status_check;
ALTER TABLE access_requests ADD CONSTRAINT access_requests_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED'));
