-- ============================================================================
-- API Hub — 031_docs_table_blocks.sql
-- Docs round 3 (DR6): widen doc_blocks.block_type to admit a 'table' block.
-- Table content is { rows: string[][], caption? } with server-side size/cell
-- guardrails enforced in the route layer (TABLE_MAX_ROWS/COLS/CELL).
-- ============================================================================

ALTER TABLE doc_blocks DROP CONSTRAINT doc_blocks_type_check;

ALTER TABLE doc_blocks
  ADD CONSTRAINT doc_blocks_type_check CHECK (
    block_type IN ('heading', 'text', 'code', 'payload', 'response', 'schema', 'list', 'image', 'table')
  );
