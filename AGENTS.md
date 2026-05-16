# AGENTS.md

## Project identity
- This is an **OpenCode AI plugin** (id: `export-doc`), not a standalone app or library.
- Entrypoint: `export-doc.ts`. No build step, no package.json.

## Architecture
- The plugin loads dependency-export documentation so agents can correctly call external modules without guessing signatures, endpoints, or types.
- Dep config lives at `.xtconfig/dependencies.json` (`{ "modules": [{ "name", "path" }] }`). Dependencies are loaded recursively via each dep's own `dependencies.json`.
- Each dep module must have an `EXPORT.md` with YAML frontmatter fields: `name`, `description`, `version`, `whenToUse`, `exports` (comma-separated relative paths prefixed with `./`).
- `exports` field controls which source files `read_dep_source` tool can read. Paths must match the module root exactly.

## Plugin hooks (3 integration points)
1. `command.execute.before` — injects the EXPORT.md creation prompt when `/init` is run.
2. `experimental.chat.system.transform` — injects the local EXPORT.md content and dependency list into the chat system prompt.
3. Custom tools — `load_export_doc` (fetch full EXPORT.md for a module) and `read_dep_source` (read allowed source files from a module).

## Key constraints
- `load_export_doc` is the **only** correct way for agents to learn a dependency module's API. Skipping it will cause incorrect imports and type errors by design.
- `read_dep_source` allows reading only files listed in the module's `exports` frontmatter field — arbitrary file reads are rejected.
- Remote dependencies (http/https paths) are supported for `load_export_doc` but NOT for `read_dep_source`.
