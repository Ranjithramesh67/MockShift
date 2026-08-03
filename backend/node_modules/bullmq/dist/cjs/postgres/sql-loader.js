"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMigrationSql = loadMigrationSql;
exports.loadCommandSql = loadCommandSql;
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * Loads a migration's SQL from its `.sql` file — the portable source of truth
 * shared with the Elixir/Python ports. Results are cached after the first read.
 *
 * The `.sql` files live next to this module under `migrations/`. The published
 * build copies them alongside the compiled output (a `copy:sql` build step,
 * analogous to how the Lua scripts are bundled), so the same relative lookup
 * works at runtime.
 */
const MIGRATIONS_DIR = (0, path_1.join)(__dirname, 'migrations');
/**
 * Runtime queries live under `commands/`. Each `.sql` file is one parameterized
 * statement (a `SELECT fn(...)` for the PL/pgSQL operations, or a direct
 * query). They contain NO schema/namespace references — the connection's
 * `search_path` selects the schema — so they are portable verbatim to the
 * Python/Elixir/PHP/Rust ports (mirroring how the Redis backend's `.lua`
 * scripts never hardcode the key prefix).
 */
const COMMANDS_DIR = (0, path_1.join)(__dirname, 'commands');
const migrationCache = new Map();
const commandCache = new Map();
function loadMigrationSql(file) {
    let sql = migrationCache.get(file);
    if (sql === undefined) {
        sql = (0, fs_1.readFileSync)((0, path_1.join)(MIGRATIONS_DIR, file), 'utf8');
        migrationCache.set(file, sql);
    }
    return sql;
}
/**
 * Loads a runtime command's SQL by name (without the `.sql` extension), cached
 * after the first read.
 */
function loadCommandSql(name) {
    let sql = commandCache.get(name);
    if (sql === undefined) {
        sql = (0, fs_1.readFileSync)((0, path_1.join)(COMMANDS_DIR, `${name}.sql`), 'utf8');
        commandCache.set(name, sql);
    }
    return sql;
}
