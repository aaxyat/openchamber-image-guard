/**
 * Image Guard settings panel.
 *
 * Edits ~/.config/opencode/image-guard.json, the same file the bundled OpenCode
 * plugin reads on every request (it re-reads when the file's mtime changes, so a
 * save here applies to the running session without a restart).
 */
import { connectHost } from "@openchamber/sdk"

const CONFIG = "~/.config/opencode/image-guard.json"
const DEFAULT_MODEL = "mistral/deepseek-v4-1-flash-1017"

type Config = { version: number; models: Record<string, number> }

const host = connectHost()
const root = document.querySelector("#root") as HTMLElement | null
if (!root) throw new Error("Missing #root")

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

let config: Config = { version: 1, models: { [DEFAULT_MODEL]: 15 } }
let lastMtime = -1
let dirty = false

const status = el("p", "status", "")
const rows = el("div", "rows")
const modelInput = el("input", "input") as HTMLInputElement
const capInput = el("input", "input cap") as HTMLInputElement
const addButton = el("button", "btn", "Add") as HTMLButtonElement
const saveButton = el("button", "btn primary", "Save") as HTMLButtonElement
const reloadButton = el("button", "btn ghost", "Reload") as HTMLButtonElement

modelInput.placeholder = "provider/model or provider/*"
modelInput.spellcheck = false
capInput.type = "number"
capInput.min = "1"
capInput.max = "1000"
capInput.value = "15"

function say(message: string, tone: "ok" | "warn" | "err" = "ok") {
  status.textContent = message
  status.dataset.tone = tone
}

function normalize(input: unknown): Config {
  const raw = (input ?? {}) as Partial<Config>
  const models: Record<string, number> = {}
  for (const [model, value] of Object.entries(raw.models ?? {})) {
    const cap = typeof value === "string" ? Number.parseInt(value, 10) : value
    if (typeof cap === "number" && Number.isFinite(cap) && cap > 0) models[model] = Math.floor(cap)
  }
  return { version: 1, models }
}

function render() {
  rows.replaceChildren()
  const entries = Object.entries(config.models).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) {
    rows.append(el("p", "empty", "No limits set. Every model is unguarded."))
    return
  }
  for (const [model, cap] of entries) {
    const row = el("div", "row")
    const name = el("span", "model", model)
    const input = el("input", "input cap") as HTMLInputElement
    input.type = "number"
    input.min = "1"
    input.max = "1000"
    input.value = String(cap)
    input.addEventListener("input", () => {
      const next = Number.parseInt(input.value, 10)
      if (Number.isFinite(next) && next > 0) {
        config.models[model] = next
        dirty = true
      }
    })
    const remove = el("button", "btn ghost danger", "Remove") as HTMLButtonElement
    remove.addEventListener("click", () => {
      delete config.models[model]
      dirty = true
      render()
    })
    row.append(name, input, remove)
    rows.append(row)
  }
}

async function load(announce = true) {
  try {
    const info = await host.stat(CONFIG)
    if (info.kind === "missing") {
      config = { version: 1, models: { [DEFAULT_MODEL]: 15 } }
      lastMtime = -1
      dirty = false
      render()
      if (announce) say("No settings file yet. Showing the default; Save creates it.", "warn")
      return
    }
    const { content } = await host.readFile(CONFIG)
    config = normalize(JSON.parse(content))
    lastMtime = info.mtime ?? -1
    dirty = false
    render()
    if (announce) say("Loaded.", "ok")
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === "HOST_UNAVAILABLE") {
      say("Open this panel inside OpenChamber to edit settings.", "warn")
      return
    }
    if (code === "NOT_FOUND") {
      config = { version: 1, models: { [DEFAULT_MODEL]: 15 } }
      dirty = false
      render()
      if (announce) say("No settings file yet. Showing the default; Save creates it.", "warn")
      return
    }
    say(`Could not read settings: ${code ?? (error as Error)?.message ?? "unknown error"}`, "err")
  }
}

async function save() {
  const clean: Config = { version: 1, models: {} }
  for (const [model, cap] of Object.entries(config.models)) {
    if (!model.includes("/")) {
      say(`"${model}" is not a provider/model id.`, "err")
      return
    }
    if (!Number.isFinite(cap) || cap <= 0) {
      say(`"${model}" needs a positive limit.`, "err")
      return
    }
    clean.models[model] = Math.floor(cap)
  }
  try {
    await host.writeFile(CONFIG, `${JSON.stringify(clean, null, 2)}\n`)
    config = clean
    dirty = false
    const info = await host.stat(CONFIG).catch(() => null)
    lastMtime = (info as { mtime?: number } | null)?.mtime ?? -1
    render()
    await host.toast({ kind: "success", message: "Image Guard settings saved" })
    say("Saved. The running plugin picks it up on the next request.", "ok")
  } catch (error) {
    say(`Could not save: ${(error as { code?: string })?.code ?? (error as Error)?.message ?? "unknown error"}`, "err")
  }
}

function add() {
  const model = modelInput.value.trim()
  const cap = Number.parseInt(capInput.value, 10)
  if (!model.includes("/")) {
    say("Enter a provider/model id, for example mistral/some-model.", "err")
    return
  }
  if (!Number.isFinite(cap) || cap <= 0 || cap > 1000) {
    say("The limit must be a whole number between 1 and 1000.", "err")
    return
  }
  config.models[model] = cap
  dirty = true
  modelInput.value = ""
  render()
  say("Added. Press Save to write it.", "warn")
}

addButton.addEventListener("click", add)
modelInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") add()
})
saveButton.addEventListener("click", () => void save())
reloadButton.addEventListener("click", () => void load())

// Reflect edits made by the CLI or another window without a reload.
setInterval(() => {
  if (dirty) return
  void host
    .stat(CONFIG)
    .then((info) => {
      const mtime = (info as { mtime?: number }).mtime ?? -1
      if (info.kind !== "missing" && mtime !== lastMtime) void load(false)
    })
    .catch(() => {})
}, 3000)

const wrap = el("div", "wrap")
const head = el("div", "head")
head.append(el("h1", "", "Image Guard"), el("p", "sub", "Image limits per model. The plugin re-reads this file on every request."))

const pathRow = el("div", "pathrow")
pathRow.append(el("span", "label", "Settings file"), el("code", "path", CONFIG))

const addRow = el("div", "addrow")
addRow.append(modelInput, capInput, addButton)

const actions = el("div", "actions")
actions.append(saveButton, reloadButton)

wrap.append(head, pathRow, rows, addRow, actions, status)
root.append(wrap)

render()
void load()
