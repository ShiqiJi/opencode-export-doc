import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import fs from "fs/promises"
import path from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DepEntry {
  name: string
  path: string
}

interface ExportDoc {
  name: string
  description: string
  version: string
  whenToUse: string
  exports: string
  content: string
  dir: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_FILE = ".xtconfig/dependencies.json"
const EXPORT_FILE = "EXPORT.md"

const INIT_PROMPT = [
  "",
  "Also create or update `EXPORT.md` alongside `AGENTS.md`.",
  "",
  "`EXPORT.md` documents the public surface a module exposes to callers.",
  "The goal: an external agent can integrate and use this module correctly",
  "without reading its internal source code.",
  "",
  "## What to extract",
  "Only facts a caller would get wrong without documentation:",
  "- exact function signatures, class shapes, type definitions",
  "- endpoint URLs, request/response formats, protocol details",
  "- CLI entry points, linker flags, package names, environment requirements",
  "- data schemas, event payloads, message formats, config shapes",
  "- ordering requirements (e.g. authenticate before query)",
  "Prefer executable truth over prose. Verify claims against the actual code.",
  "",
  "## Frontmatter",
  "- `name`: module identifier",
  "- `description`: one-line summary of what this module provides",
  "- `version`: current version — update on breaking changes",
  "- `whenToUse`: concrete trigger conditions for a consuming agent",
  "- `exports`: comma-separated list of files that expose public API surface.",
  "  Every path must start with `./` relative to the module root,",
  "  e.g. `./main.py, ./src/api.ts, ./src/types.ts`.",
  "",
  "## Content",
  "After the frontmatter block, write the actual export documentation as the body.",
  "This is the executable reference a caller pastes into their editor. Include:",
  "- every exported function/method with its full signature, parameter types, and return type",
  "- every exported type/interface/class with its shape and required fields",
  "- every endpoint URL with method, path, request body schema, and response shape",
  "- every CLI flag, env var, config key, or linker option with its effect and default",
  "- copy-pasteable import/include examples — prefer code blocks",
  "",
  "Each exported item MUST be annotated with its source file in parentheses, e.g.:",
  "  `getUser(id: string): Promise<User>` (src/api/users.ts)",
  "  `POST /v1/login` (src/routes/auth.ts)",
  "This lets callers go directly to the source when they need more detail.",
  "",
  "Same rules as AGENTS.md: if a line wouldn't prevent a mistake, omit it.",
  "If `EXPORT.md` already exists, improve in place — don't rewrite blindly.",
].join("\n")

const SYNC_INSTRUCTION = [
  "If you modify any interfaces, exports, endpoints, schemas, or module contracts",
  "mentioned in `EXPORT.md`, you MUST update the file to keep it accurate.",
  "Update the `version` field when breaking changes are introduced.",
].join("\n")

const TOOL_DESCRIPTION = [
  "Load the complete export documentation for an external dependency module.",
  "",
  "IMPORTANT — always call this tool BEFORE writing any code that:",
  "- imports, includes, requires, or otherwise references an external module",
  "- calls a function or method from a dependency listed in Available Dependency Exports",
  "- uses a data type, class, or schema defined by an external module",
  "- sends requests to an external service endpoint",
  "- invokes an external CLI tool or binary",
  "",
  "The returned documentation includes function signatures, type definitions, endpoint URLs,",
  "protocol details, and import/include paths needed to correctly integrate with the module.",
  "Skipping this step will likely result in incorrect API usage and type errors.",
].join("\n")

const TOOL_MODULE_ARG_DESC =
  "Module name from the available dependency exports listed in the system prompt"

const READ_SOURCE_TOOL_DESCRIPTION = [
  "Read the raw content of a file listed in a dependency module's `exports` field.",
  "",
  "Use this tool to verify claims made in the module's export documentation against",
  "the actual source. The exported file may contain implementations, re-exports, type",
  "definitions, or barrel files — treat the returned content as ground truth.",
  "You may ONLY request files that appear in the module's `exports` list —",
  "arbitrary file reads are rejected.",
  "Reads scoped to the `exports` list do not require user permission approval.",
].join("\n")

const READ_SOURCE_FILE_ARG_DESC =
  "Relative file path from the module's exports list (must match exactly)"

const DEP_HEADER_PREFIX = [
  "",
  "## Available Dependency Exports",
  "",
  "Before calling, importing, or integrating with any module listed below, you MUST",
  "use the `load_export_doc` tool to load its full export documentation.",
  "Do NOT guess function signatures, endpoint URLs, type shapes, or import paths.",
  "",
].join("\n")

const LOCAL_INSTRUCTION_PREFIX = "Instructions from: EXPORT.md"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractExportsField(fm: string): string {
  const m = fm.match(/^exports:\s*(.+)$/m)
  return m
    ? m[1]
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p !== "")
        .join(", ")
    : ""
}

function parseFrontmatter(raw: string, filepath: string): Omit<ExportDoc, "dir" | "exports"> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const fm = match?.[1] ?? ""
  return {
    name: fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()
      || path.basename(path.dirname(filepath)),
    description: fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "",
    version: fm.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? "",
    whenToUse: fm.match(/^whenToUse:\s*(.+)$/m)?.[1]?.trim() ?? "",
    content: match ? match[2].trim() : raw,
  }
}

function resolveDir(raw: string, baseDir: string): string {
  if (/^https?:\/\//i.test(raw)) return raw
  if (path.isAbsolute(raw)) return raw
  return path.resolve(baseDir, raw)
}

function formatDepList(docs: ExportDoc[]): string {
  return docs
    .map((d) => {
      const parts = [`**${d.name}**`]
      if (d.version) parts.push(`v${d.version}`)
      if (d.description) parts.push(`— ${d.description}`)
      if (d.exports) parts.push(`\n  Exports: \`${d.exports}\``)
      if (d.whenToUse) parts.push(`\n  When: ${d.whenToUse}`)
      return parts.join(" ")
    })
    .join("\n")
}

function formatToolResult(doc: ExportDoc, exports: string): string {
  const header = [
    `# ${doc.name}` + (doc.version ? ` v${doc.version}` : ""),
    doc.description || "",
  ]
  if (exports) {
    header.push(`\nExports: \`${exports}\``)
  }
  return [...header, "", doc.content].join("\n")
}

// ---------------------------------------------------------------------------
// Recursive loader
// ---------------------------------------------------------------------------

async function loadRecursive(
  deps: DepEntry[],
  baseDir: string,
  visited: Set<string>,
  docs: ExportDoc[],
  dirMap: Map<string, string>,
): Promise<void> {
  for (const dep of deps) {
    if (visited.has(dep.name)) continue
    visited.add(dep.name)

    let resolved: string
    try {
      resolved = resolveDir(dep.path, baseDir)
      let raw: string

      if (/^https?:\/\//i.test(resolved)) {
        const url = resolved.endsWith("/")
          ? `${resolved}${EXPORT_FILE}`
          : `${resolved}/${EXPORT_FILE}`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        raw = await res.text()
      } else {
        raw = await fs.readFile(path.join(resolved, EXPORT_FILE), "utf-8")
      }

      const base = parseFrontmatter(raw, dep.path)
      if (!base.name) base.name = dep.name
      else dep.name = base.name
      const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      const exports = extractExportsField(fm?.[1] ?? "")
      docs.push({ ...base, exports, dir: resolved })

      if (!/^https?:\/\//i.test(resolved)) {
        dirMap.set(dep.name, resolved)
        try {
          const childRaw = await fs.readFile(path.join(resolved, CONFIG_FILE), "utf-8")
          const childCfg = JSON.parse(childRaw)
          const children: DepEntry[] = childCfg.modules ?? []
          if (children.length > 0) {
            await loadRecursive(children, resolved, visited, docs, dirMap)
          }
        } catch { /* no transitive deps */ }
      }
    } catch { /* skip unresolvable deps */ }
  }
}

// ---------------------------------------------------------------------------
// Dynamic state
// ---------------------------------------------------------------------------

interface State {
  depDocs: ExportDoc[]
  dirMap: Map<string, string>
  configMtime: number
}

async function reloadState(root: string, state: State): Promise<boolean> {
  const configPath = path.join(root, CONFIG_FILE)
  let stat: { mtimeMs: number }
  try {
    stat = await fs.stat(configPath)
  } catch {
    return false
  }

  if (stat.mtimeMs <= state.configMtime) return false

  try {
    const raw = await fs.readFile(configPath, "utf-8")
    const cfg = JSON.parse(raw)
    const deps: DepEntry[] = cfg.modules ?? []
    const newDocs: ExportDoc[] = []
    const newDirMap = new Map<string, string>()
    await loadRecursive(deps, root, new Set(), newDocs, newDirMap)
    state.depDocs = newDocs
    state.dirMap = newDirMap
    state.configMtime = stat.mtimeMs
    console.log(`[export-doc] reloaded — ${newDocs.length} deps: ${newDocs.map((d) => d.name).join(", ") || "(none)"}`)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default {
  id: "export-doc",
  server: async (input): Promise<Awaited<ReturnType<Plugin>>> => {
    const root = input.directory

    const state: State = { depDocs: [], dirMap: new Map(), configMtime: 0 }

    // ── Initial load ──
    const configPath = path.join(root, CONFIG_FILE)
    try {
      const stat = await fs.stat(configPath)
      const raw = await fs.readFile(configPath, "utf-8")
      const cfg = JSON.parse(raw)
      const deps: DepEntry[] = cfg.modules ?? []
      await loadRecursive(deps, root, new Set(), state.depDocs, state.dirMap)
      state.configMtime = stat.mtimeMs
    } catch {
      try {
        await fs.mkdir(path.dirname(configPath), { recursive: true })
        await fs.writeFile(configPath, JSON.stringify({ modules: [] }, null, 2) + "\n")
        state.configMtime = (await fs.stat(configPath)).mtimeMs
      } catch { /* fs error */ }
    }

    console.log(`[export-doc] loaded — ${state.depDocs.length} deps: ${state.depDocs.map((d) => d.name).join(", ") || "(none)"}`)

    return {
      // ── /init integration ──
      "command.execute.before": async (ctx, output) => {
        if (ctx.command !== "init") return
        output.parts.push({ type: "text", text: INIT_PROMPT } as any)
      },

      // ── Custom tools ──
      tool: {
        load_export_doc: tool({
          description: TOOL_DESCRIPTION,
          args: {
            module: tool.schema.string().describe(TOOL_MODULE_ARG_DESC),
          },
          async execute(args) {
            await reloadState(root, state)

            const doc = state.depDocs.find((d) => d.name === args.module)
            if (!doc) {
              const available = state.depDocs.map((d) => d.name).join(", ")
              throw new Error(`Module "${args.module}" not found. Available: ${available || "none"}`)
            }

            let raw: string
            if (/^https?:\/\//i.test(doc.dir)) {
              const url = doc.dir.endsWith("/")
                ? `${doc.dir}${EXPORT_FILE}`
                : `${doc.dir}/${EXPORT_FILE}`
              const res = await fetch(url)
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              raw = await res.text()
            } else {
              raw = await fs.readFile(path.join(doc.dir, EXPORT_FILE), "utf-8")
            }
            const base = parseFrontmatter(raw, doc.dir)
            const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
            const exports = extractExportsField(fm?.[1] ?? "")

            return formatToolResult({ ...doc, ...base }, exports)
          },
        }),

        read_dep_source: tool({
          description: READ_SOURCE_TOOL_DESCRIPTION,
          args: {
            module: tool.schema.string().describe(TOOL_MODULE_ARG_DESC),
            file: tool.schema.string().describe(READ_SOURCE_FILE_ARG_DESC),
          },
          async execute(args) {
            await reloadState(root, state)

            const doc = state.depDocs.find((d) => d.name === args.module)
            if (!doc) {
              const available = state.depDocs.map((d) => d.name).join(", ")
              throw new Error(`Module "${args.module}" not found. Available: ${available || "none"}`)
            }

            const isRemote = /^https?:\/\//i.test(doc.dir)
            if (isRemote) {
              throw new Error("Cannot read source files from remote modules")
            }

            const stripDotSlash = (p: string) => p.replace(/^\.\//, "")

            const allowed = doc.exports
              .split(",")
              .map((p) => p.trim())
              .filter((p) => p !== "")

            const normalized = stripDotSlash(args.file)
            if (!allowed.some((p) => stripDotSlash(p) === normalized)) {
              throw new Error(
                `File "${args.file}" is not in the exports list of "${args.module}". ` +
                `Allowed files:\n${allowed.map((f) => `  - ${f}`).join("\n")}`,
              )
            }

            const filePath = path.join(doc.dir, args.file)
            return fs.readFile(filePath, "utf-8")
          },
        }),
      },

      // ── System prompt injection ──
      "experimental.chat.system.transform": async (_ctx, output) => {
        await reloadState(root, state)

        try {
          const file = path.join(root, EXPORT_FILE)
          const content = await fs.readFile(file, "utf-8")
          if (content.trim()) {
            output.system.push(`${LOCAL_INSTRUCTION_PREFIX}\n${content}`)
          }
        } catch {}
        output.system.push(SYNC_INSTRUCTION)

        if (state.depDocs.length > 0) {
          output.system.push(DEP_HEADER_PREFIX + "\n" + formatDepList(state.depDocs))
        }
      },
    }
  },
}
