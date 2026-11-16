-- ============================================================================
-- Mockshift — 066_docs_file_blocks.sql
-- Docs file attachments: widen doc_blocks.block_type to admit a 'file' block.
-- File content is { src, fileName, mime?, caption? }. src is an http(s) URL or
-- a data: URL; decoded payload is capped at 10 MB in the route layer.
-- ============================================================================

ALTER TABLE doc_blocks DROP CONSTRAINT doc_blocks_type_check;

ALTER TABLE doc_blocks
  ADD CONSTRAINT doc_blocks_type_check CHECK (
    block_type IN ('heading', 'text', 'code', 'payload', 'response', 'schema', 'list', 'image', 'table', 'file')
  );

COMMENT ON COLUMN doc_blocks.block_type IS
  'One of heading, text, code, payload, response, schema, list, image, table or file; required content keys are validated in the route layer.';
