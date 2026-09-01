-- Migration 002: Add index on audit action column for faster searching

CREATE INDEX IF NOT EXISTS audit_action_idx ON audit (action);
