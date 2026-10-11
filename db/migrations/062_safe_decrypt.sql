-- Fail-safe decryption helper + variable resolver hardening.
--
-- pgp_sym_decrypt() RAISES when the ciphertext cannot be decrypted (wrong or
-- rotated VAULT_KEY, corrupt value). That made a single bad secret abort the
-- whole variable cascade — a request run or a variables listing would 500.
-- The resolver was documented to treat undecryptable secrets as NULL; this
-- enforces that contract and also lets such a secret be overwritten/removed.

CREATE OR REPLACE FUNCTION app.try_decrypt(_data bytea, _key text)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF _data IS NULL OR _key IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pgp_sym_decrypt(_data, _key);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION app.try_decrypt(bytea, text) TO app_user;

-- Variable cascade resolver, now NULL-safe on undecryptable secrets.
-- Priority (highest first): REQUEST > ENVIRONMENT > WORKSPACE > GLOBAL.
CREATE OR REPLACE FUNCTION app.resolve_variables(_request_id uuid, _environment_id uuid)
RETURNS TABLE (key text, value text, source text)
LANGUAGE plpgsql STABLE AS $$
DECLARE _ws uuid;
BEGIN
  SELECT p.workspace_id INTO _ws
  FROM api_requests ar
  JOIN collections c ON c.id = ar.collection_id
  JOIN projects p    ON p.id = c.project_id
  WHERE ar.id = _request_id;

  IF _ws IS NULL THEN
    SELECT workspace_id INTO _ws FROM environments WHERE id = _environment_id;
  END IF;

  RETURN QUERY
  WITH resolved AS (
    SELECT s.key, s.val, s.lvl,
           CASE s.lvl WHEN 'REQUEST' THEN 1 WHEN 'ENVIRONMENT' THEN 2 WHEN 'WORKSPACE' THEN 3 ELSE 4 END AS pri
    FROM (
      SELECT v.key,
             CASE WHEN v.is_secret THEN app.try_decrypt(v.value_encrypted, app.vault_key()) ELSE v.value_plain END AS val,
             'GLOBAL' AS lvl
      FROM variables v WHERE v.scope = 'GLOBAL'
      UNION ALL
      SELECT v.key,
             CASE WHEN v.is_secret THEN app.try_decrypt(v.value_encrypted, app.vault_key()) ELSE v.value_plain END AS val,
             'WORKSPACE' AS lvl
      FROM variables v WHERE v.scope = 'WORKSPACE' AND v.workspace_id = _ws
      UNION ALL
      SELECT v.key,
             CASE WHEN v.is_secret THEN app.try_decrypt(v.value_encrypted, app.vault_key()) ELSE v.value_plain END AS val,
             'ENVIRONMENT' AS lvl
      FROM variables v WHERE v.scope = 'ENVIRONMENT' AND v.environment_id = _environment_id
      UNION ALL
      SELECT v.key,
             CASE WHEN v.is_secret THEN app.try_decrypt(v.value_encrypted, app.vault_key()) ELSE v.value_plain END AS val,
             'REQUEST' AS lvl
      FROM variables v WHERE v.scope = 'REQUEST' AND v.request_id = _request_id
    ) s
  )
  SELECT DISTINCT ON (resolved.key) resolved.key, resolved.val, resolved.lvl
  FROM resolved
  ORDER BY resolved.key, resolved.pri;
END;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_variables(uuid, uuid) TO app_user;
