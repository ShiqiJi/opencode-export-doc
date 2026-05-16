# export-doc

OpenCode plugin that provides export-documentation loading for dependency modules. Agents use it to discover correct function signatures, endpoint URLs, type shapes, and import paths without guessing.

## How it works

- Reads `.xtconfig/dependencies.json` to discover dependency modules
- Each dependency provides an `EXPORT.md` with YAML frontmatter documenting its public surface
- Dependencies are loaded recursively via each module's own `dependencies.json`
- Injects two tools into OpenCode: `load_export_doc` and `read_dep_source`
- Hooks into chat system prompts and `/init` commands

## Installing

Copy `export-doc.ts` into your OpenCode plugins directory, or configure `opencode.json` to point to it.

## Configuration

Create `.xtconfig/dependencies.json` in your project root:

```json
{
  "modules": [
    { "name": "my-lib", "path": "../my-lib" }
  ]
}
```

Each dependency module must have an `EXPORT.md` with frontmatter:

```markdown
---
name: my-lib
description: A utility library
version: 1.0.0
whenToUse: When calling functions from my-lib
exports: ./index.ts, ./types.ts
---

## Exports

### `doThing(x: number): string` (./index.ts)
...
```

## License

MIT
