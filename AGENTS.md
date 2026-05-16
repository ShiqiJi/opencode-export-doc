# AGENTS.md

## Project identity
- OpenCode AI plugin (id: `export-doc`), not a standalone app or library.
- Entrypoint: `export-doc.ts`, declared as `"./server": "./export-doc.ts"` in package.json `exports`.
- No build step — OpenCode runs the `.ts` source directly.
- Peer dep `@opencode-ai/plugin` is provided at runtime by OpenCode; do **not** `npm install`.

## Architecture
- Loads dependency `EXPORT.md` docs so agents can call external modules correctly.
- Dep config: `.xtconfig/dependencies.json` (`{ "modules": [{ "name", "path" }] }`). Loaded recursively via each dep's own `dependencies.json`.
- Each dep module must have an `EXPORT.md` with YAML frontmatter:
  `name`, `description`, `version`, `whenToUse`, `exports` (comma-separated relative paths prefixed with `./`).
- The `exports` frontmatter field is the allowlist for `read_dep_source`. Paths must match exactly.

## Plugin hooks
1. `command.execute.before` — injects EXPORT.md creation prompt when `/init` runs.
2. `experimental.chat.system.transform` — injects local EXPORT.md + dependency list into chat system prompt.
3. Custom tools — `load_export_doc` (fetch full EXPORT.md for a module) and `read_dep_source` (read allowed source files).

## Key constraints
- `load_export_doc` is the **only** correct way to learn a dependency module's API.
- `read_dep_source` reads only files in the module's `exports` list; arbitrary reads are rejected.
- Remote dependencies (http/https paths) work for `load_export_doc` but NOT `read_dep_source`.

## Configuration
- The plugin creates `.xtconfig/dependencies.json` with `{ "modules": [] }` if it doesn't exist.
- State reloads on mtime change of `dependencies.json` — no server restart needed.
