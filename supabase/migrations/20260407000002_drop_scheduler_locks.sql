-- Remove unnecessary scheduler_locks table.
-- Lock coordination is handled in-memory since we run a single instance.
DROP TABLE IF EXISTS scheduler_locks;
