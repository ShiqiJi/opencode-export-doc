---
name: export-doc
description: OpenCode plugin that loads dependency export documentation so agents can correctly call external modules without guessing signatures, endpoints, or types.
version: 1.1.0
whenToUse: When configuring OpenCode plugins, loading API docs for dependency modules, or reading allowed source files from a dependency's exports list.
exports: ./export-doc.ts, ./package.json
---

## Plugin registration

The default export is a `Plugin` object with `id: "export-doc"` and a `server` factory function.

```json
// opencode.json
{
  "plugin": ["github:ShiqiJi/opencode-export-doc"]
}
```

The `server` function receives `{ directory: string }` and returns:
```
{
  "command.execute.before": (ctx, output) => void,
  "experimental.chat.system.transform": (ctx, output) => void,
  tool: {
    load_export_doc: ToolDefinition,
    read_dep_source: ToolDefinition,
    mail_send: ToolDefinition,
  }
}
```

All returned fields are optional; the plugin works with partial returns (`export-doc.ts:316-463`).

## Configuration file

Path: `.xtconfig/dependencies.json` (`export-doc.ts:29`)

```json
{
  "modules": [
    { "name": "my-lib", "path": "../my-lib" }
  ]
}
```

- `name` (string): module identifier used in `load_export_doc` tool calls.
- `path` (string): relative or absolute filesystem path, or http/https URL to the module root.

The file is auto-created with `{ "modules": [] }` if missing (`export-doc.ts:307-312`).

## Dependency EXPORT.md format

Each module must provide an `EXPORT.md` at its root with YAML frontmatter:

```markdown
---
name: my-lib
description: A utility library
version: 1.0.0
whenToUse: When calling functions from my-lib
exports: ./index.ts, ./types.ts
---
```

Required frontmatter fields:
- `name` — module identifier (falls back to directory basename if omitted, `export-doc.ts:156-157`)
- `exports` — comma-separated paths starting with `./`; the allowlist for `read_dep_source` (`export-doc.ts:142-150`)

The body after `---` is the human-readable export documentation.

## Tool: `load_export_doc` (`export-doc.ts:325-356`)

### Description
Load the complete export documentation for an external dependency module. Must be called BEFORE any code that imports, calls, or integrates with a dependency.

### Parameters
| Param | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module name from available dependency exports list |

### Returns
Markdown string in the format:
```
# {name} [v{version}]
{description}

Exports: `./file1.ts, ./file2.ts`

{content body from EXPORT.md}
```

### Errors
- `Module "{name}" not found. Available: ...` — when module not in dependency list.
- `HTTP {status}` — when remote fetch fails.

## Tool: `read_dep_source` (`export-doc.ts:358-396`)

### Description
Read raw content of a file listed in a dependency module's `exports` field. Only files in the exports list are accessible.

### Parameters
| Param | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module name from available dependency exports list |
| `file` | `string` | Relative path from module's exports list (must match exactly) |

### Returns
Raw file content as string (UTF-8).

### Errors
- `Module "{name}" not found. Available: ...`
- `Cannot read source files from remote modules` — remote (http/https) dependencies are not supported.
- `File "{file}" is not in the exports list...` — path not in the module's `exports` field.

## Tool: `mail_send` (`export-doc.ts:398-443`)

### Description
Send a mail message to a dependency module's mailbox. Creates a mail file in the target module's `.xtconfig/mailbox/` directory. The file includes the sender module name, timestamp, and the message content.

### Parameters
| Param | Type | Description |
|-------|------|-------------|
| `module` | `string` | Target module name from available dependency exports list |
| `title` | `string` | Mail title (single line) |
| `content` | `string` | Mail body content |

### Returns
Confirmation string with the relative path to the created mail file.

### Errors
- `Module "{name}" not found. Available: ...` — when module not in dependency list.
- `Cannot send mail to remote modules` — remote (http/https) dependencies do not support mail.

### Mail file format
```
Time: {ISO timestamp}
From: {sender}
To: {target}
Title: {single-line title}
Content: {single-line content}
```

File naming: `{ISO-safe}_{sender}.md` in `.xtconfig/mailbox/` of the target module.

## Hooks

### `command.execute.before` (`export-doc.ts:318-321`)
Triggers on `/init` command. Injects the AGENTS.md/EXPORT.md creation prompt into the output stream.

### `experimental.chat.system.transform` (`export-doc.ts:446-462`)
On every chat turn:
1. Reads local `EXPORT.md` and injects it into system prompt (prefixed with `Instructions from: EXPORT.md`).
2. Injects the `SYNC_INSTRUCTION` reminder to keep `EXPORT.md` accurate and to never modify other modules' code (use `mail_send` instead).
3. Formats and injects the dependency list from `dependencies.json` (recursively resolved).

## Types

```ts
interface DepEntry {
  name: string
  path: string
}

interface ExportDoc {
  name: string
  description: string
  version: string
  whenToUse: string
  exports: string        // comma-separated from frontmatter
  content: string        // body after YAML frontmatter
  dir: string            // resolved module directory
}
```
(`export-doc.ts:10-23`)

## Internal functions (for reference)

### `loadRecursive(deps, baseDir, visited, docs, dirMap): Promise<void>` (`export-doc.ts:199-246`)
Recursively loads EXPORT.md from each dependency. For local deps, also reads their `dependencies.json` to discover transitive dependencies. Skipped deps and HTTP errors are silently ignored.

### `reloadState(root, state): Promise<boolean>` (`export-doc.ts:258-284`)
Reloads dependency state when `dependencies.json` mtime changes. Returns `true` on successful reload.
