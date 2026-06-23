import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CMUX_TIMEOUT = 5000;
const TUI_SCRIPT = join(homedir(), ".cmuxterm", "pi-status-tui.js");
const STATUS_FILE = join(homedir(), ".cmuxterm", "pi-status.json");

interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

interface Subagent {
  role: string;
  status: string;
  task: string;
}

interface StatusData {
  version: string;
  timestamp: string;
  status: string;
  prompt: string;
  session: { id: string; cwd: string };
  todos: Todo[];
  subagents: Subagent[];
  lsp: { run: boolean; errors: number; warnings: number };
  mcp: { connected: boolean; servers: string[] };
  tools: { totalCalls: number; lastTool: string; lastResult: string };
}

const defaultStatus: StatusData = {
  version: "0.2.0",
  timestamp: new Date().toISOString(),
  status: "idle",
  prompt: "",
  session: { id: "", cwd: process.cwd() },
  todos: [],
  subagents: [],
  lsp: { run: false, errors: 0, warnings: 0 },
  mcp: { connected: false, servers: [] },
  tools: { totalCalls: 0, lastTool: "", lastResult: "ok" }
};

function ensureDir() {
  const dir = join(homedir(), ".cmuxterm");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function save(s: StatusData) {
  s.timestamp = new Date().toISOString();
  try {
    ensureDir();
    writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2));
  } catch {}
}

function cmuxExec(pi: ExtensionAPI, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    pi.exec("cmux", args, { timeout: CMUX_TIMEOUT })
      .then((r) => {
        if (r.killed || r.code !== 0) {
          resolve({ ok: false, stdout: r.stdout, stderr: r.stderr });
        } else {
          resolve({ ok: true, stdout: r.stdout, stderr: r.stderr });
        }
      })
      .catch(() => resolve({ ok: false, stdout: "", stderr: "" }));
  });
}

async function createSidebar(pi: ExtensionAPI, ws: string) {
  const panes = await cmuxExec(pi, ["--json", "list-panes", "--workspace", ws]);
  if (panes.ok) {
    try {
      const parsed = JSON.parse(panes.stdout);
      if (parsed?.panes?.length > 1) return; // already has sidebar
    } catch {}
  }

  const split = await cmuxExec(pi, ["new-split", "right", "--workspace", ws, "--focus", "false"]);
  if (!split.ok) return;

  await new Promise((r) => setTimeout(r, 800));

  const panes2 = await cmuxExec(pi, ["--json", "list-panes", "--workspace", ws]);
  if (panes2.ok) {
    try {
      const parsed = JSON.parse(panes2.stdout);
      for (const p of parsed?.panes || []) {
        for (const s of p.surface_refs || []) {
          if (s !== process.env.CMUX_SURFACE_ID) {
            await cmuxExec(pi, ["respawn-surface", "--workspace", ws, "--surface", s, "--command", `node ${TUI_SCRIPT}`]);
            return;
          }
        }
      }
    } catch {}
  }
}

function installTuiScript() {
  const tuiCode = `#!/usr/bin/env node
const fs=require("fs"),path=require("path"),W=30;
const F=path.join(require("os").homedir(),".cmuxterm","pi-status.json");
const c=()=>process.stdout.write("\\x1b[2J\\x1b[H");
const p=(s,l)=>String(s).length>=l?String(s).slice(0,l):String(s)+" ".repeat(l-Math.max(0,String(s).length));
function r(){c();console.log(p("⚡ Pi Status",W));console.log("─".repeat(W));
if(!fs.existsSync(F)){console.log(p("  (waiting for pi)",W));return;}
let d;try{d=JSON.parse(fs.readFileSync(F,"utf8"))}catch{console.log(p("  (read error)",W));return;}
const I={running:"⚡",waiting:"⏸",complete:"✓",error:"✗",tool:"🔧",idle:"○"};
console.log(p((I[d.status]||"○")+" "+d.status,W));
if(d.prompt){const t=d.prompt.length>W-2?d.prompt.slice(0,W-5)+"…":d.prompt;console.log("  "+p(t,W-2));}
console.log("─".repeat(W));
console.log("📝 "+p("TODOs",W-2));
const todos=d.todos||[];
if(!todos.length)console.log("  "+p("(none)",W-2));
else todos.slice(0,4).forEach(t=>console.log("  "+(t.done?"✓":"○")+" "+p(t.text.length>W-5?t.text.slice(0,W-8)+"…":t.text,W-5)));
console.log("─".repeat(W));
console.log("🤖 "+p("Subagents",W-2));
const ag=d.subagents||[];
if(!ag.length)console.log("  "+p("(none)",W-2));
else ag.slice(0,3).forEach(a=>console.log("  "+(a.status==="running"?"▶":"✓")+" "+p("["+a.role+"] "+(a.task||""),W-5)));
console.log("─".repeat(W));
const l=d.lsp||{};console.log(p((l.run?"🟢":"🔴")+" LSP e:"+l.errors+" w:"+l.warnings,W));
const m=d.mcp||{};console.log(p((m.connected?"🟢":"🔴")+" MCP "+m.servers.length,W));
const t=d.tools||{};console.log("🛠  "+p(t.totalCalls+" calls",W-2));
if(d.timestamp)console.log("⏱ "+p(new Date(d.timestamp).toLocaleTimeString(),W-2));
console.log("─".repeat(W));}
r();setInterval(r,2000);
process.on("SIGINT",()=>process.exit(0));
process.on("SIGTERM",()=>process.exit(0));
`;
  ensureDir();
  try {
    writeFileSync(TUI_SCRIPT, tuiCode);
  } catch {}
}

export default function piCmuxSidebarExtension(pi: ExtensionAPI) {
  // Only run inside cmux
  if (!process.env.CMUX_WORKSPACE_ID) return;

  // Install TUI script on load
  installTuiScript();

  const status: StatusData = { ...defaultStatus, session: { id: "", cwd: process.cwd() } };

  // ---- Event handlers ----

  pi.on("session_start", async () => {
    Object.assign(status, { ...defaultStatus, session: { id: pi?.session?.id || "", cwd: process.cwd() } });
    save(status);
    const ws = process.env.CMUX_WORKSPACE_ID;
    if (ws) await createSidebar(pi, ws);
  });

  pi.on("before_agent_start", async (event) => {
    status.status = "running";
    status.prompt = event.prompt?.slice(0, 80) || "";
    save(status);
  });

  pi.on("tool_execution_start", async (event) => {
    status.status = "tool";
    status.tools.lastTool = event.toolName || "";
    save(status);
  });

  pi.on("tool_result", async (event) => {
    status.tools.totalCalls++;
    status.tools.lastResult = event.isError ? "error" : "ok";
    status.status = "running";
    save(status);
  });

  pi.on("agent_end", async (event) => {
    const lastMsg = event.messages?.[event.messages.length - 1] as { role?: string; stopReason?: string } | undefined;
    status.status = (lastMsg?.role === "assistant" && lastMsg?.stopReason === "error") ? "error" : "waiting";
    save(status);
  });

  pi.on("session_shutdown", async () => {
    status.status = "idle";
    save(status);
  });

  // ---- Tools ----

  pi.registerTool?.({
    name: "status_todo",
    desc: "Add, list, toggle, or remove TODOs tracked in the cmux status panel.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "list", "toggle", "remove"], desc: "Action" },
        text: { type: "string", desc: "Todo text (for add)" },
        id: { type: "string", desc: "Todo id (for toggle/remove)" }
      },
      required: ["action"]
    },
    async execute(args: { action: string; text?: string; id?: string }) {
      if (args.action === "add" && args.text) {
        status.todos.push({
          id: Math.random().toString(36).slice(2, 8),
          text: args.text,
          done: false,
          createdAt: new Date().toISOString()
        });
      } else if (args.action === "toggle" && args.id) {
        const t = status.todos.find((x) => x.id === args.id);
        if (t) t.done = !t.done;
      } else if (args.action === "remove" && args.id) {
        status.todos = status.todos.filter((x) => x.id !== args.id);
      }
      save(status);
      return { todos: status.todos };
    }
  });

  pi.registerTool?.({
    name: "status_query",
    desc: "Return the current cmux status JSON (todos, subagents, LSP, MCP, tools).",
    parameters: { type: "object", properties: {} },
    async execute() {
      return JSON.parse(JSON.stringify(status));
    }
  });

  // Initial save
  save(status);
}
