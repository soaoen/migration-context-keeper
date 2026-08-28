#!/usr/bin/env bun
/**
 * migration-context-keeper CLI
 * 通用迁移上下文管理工具
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.cwd();
const DEFAULT_CONTEXT_DIR = ".migration-context";

interface Config {
  contextDir: string;
  defaultStates: string[];
}

interface Slice {
  name: string;
  description: string;
  contract: {
    inputs: string[];
    outputs: string[];
    sideEffects: string[];
    invariants: string[];
  };
  data: {
    tables: string[];
    reads: string[];
    writes: string[];
  };
  routes: string[];
  dependencies: {
    internal: string[];
    external: string[];
  };
  acceptance: string[];
  state: string;
  createdAt: string;
  updatedAt: string;
}

interface Decision {
  id: string;
  slug: string;
  title: string;
  status: "proposed" | "accepted" | "superseded" | "rejected";
  context: string;
  alternatives: { option: string; pros: string[]; cons: string[] }[];
  decision: string;
  consequences: string[];
  relatedSlices: string[];
  createdAt: string;
}

interface GlobalState {
  currentSlice: string | null;
  nextActions: string[];
  risks: string[];
  updatedAt: string;
}

function loadConfig(): Config {
  const configPath = join(PROJECT_ROOT, ".mckrc.json");
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  }
  return {
    contextDir: DEFAULT_CONTEXT_DIR,
    defaultStates: ["defined", "implementing", "contract-test", "shadow", "cutover", "done", "blocked", "abandoned"],
  };
}

function getContextDir(config: Config): string {
  return join(PROJECT_ROOT, config.contextDir);
}

function ensureContextDir(config: Config): void {
  const ctxDir = getContextDir(config);
  const subdirs = ["slices", "decisions"];
  for (const sub of subdirs) {
    const p = join(ctxDir, sub);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
  const statePath = join(ctxDir, "state.json");
  if (!existsSync(statePath)) {
    writeFileSync(statePath, JSON.stringify({
      currentSlice: null,
      nextActions: [],
      risks: [],
      updatedAt: new Date().toISOString(),
    }, null, 2));
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function slicePath(config: Config, name: string): string {
  return join(getContextDir(config), "slices", `${name}.json`);
}

function loadSlice(config: Config, name: string): Slice | null {
  const p = slicePath(config, name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

function saveSlice(config: Config, slice: Slice): void {
  const p = slicePath(config, slice.name);
  writeFileSync(p, JSON.stringify(slice, null, 2));
}

function listSlices(config: Config): Slice[] {
  const dir = join(getContextDir(config), "slices");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

function decisionPath(config: Config, id: string, slug: string): string {
  return join(getContextDir(config), "decisions", `${id}-${slug}.md`);
}

function listDecisions(config: Config): Decision[] {
  const dir = join(getContextDir(config), "decisions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const content = readFileSync(join(dir, f), "utf-8");
      return parseDecisionMD(content, f);
    });
}

function parseDecisionMD(content: string, filename: string): Decision {
  const frontmatterMatch = content.match(/^---([\s\S]*?)---/);
  const fm = frontmatterMatch ? frontmatterMatch[1] : "";
  const parseField = (key: string) => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : "";
  };
  const parseArray = (key: string) => {
    const m = fm.match(new RegExp(`^${key}:\\s*\\[([\s\S]*?)\\]`, "m"));
    return m ? m[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")) : [];
  };
  return {
    id: parseField("id"),
    slug: parseField("slug"),
    title: parseField("title"),
    status: (parseField("status") as Decision["status"]) || "proposed",
    context: parseField("context"),
    alternatives: [],
    decision: parseField("decision"),
    consequences: parseArray("consequences"),
    relatedSlices: parseArray("relatedSlices"),
    createdAt: parseField("createdAt"),
  };
}

function saveDecision(config: Config, decision: Decision): void {
  const p = decisionPath(config, decision.id, decision.slug);
  const fm = `---
id: ${decision.id}
slug: ${decision.slug}
title: ${decision.title}
status: ${decision.status}
context: ${decision.context}
decision: ${decision.decision}
consequences: [${decision.consequences.map(c => `"${c}"`).join(", ")}]
relatedSlices: [${decision.relatedSlices.map(s => `"${s}"`).join(", ")}]
createdAt: ${decision.createdAt}
---`;
  const body = `\n## 背景\n${decision.context}\n\n## 决策\n${decision.decision}\n\n## 后果\n${decision.consequences.map(c => `- ${c}`).join("\n")}\n`;
  writeFileSync(p, fm + body);
}

function statePath(config: Config): string {
  return join(getContextDir(config), "state.json");
}

function loadState(config: Config): GlobalState {
  const p = statePath(config);
  if (!existsSync(p)) return { currentSlice: null, nextActions: [], risks: [], updatedAt: nowISO() };
  return JSON.parse(readFileSync(p, "utf-8"));
}

function saveState(config: Config, state: GlobalState): void {
  writeFileSync(statePath(config), JSON.stringify({ ...state, updatedAt: nowISO() }, null, 2));
}

function dumpContext(config: Config): object {
  const slices = listSlices(config);
  const decisions = listDecisions(config);
  const state = loadState(config);
  return {
    version: 1,
    exportedAt: nowISO(),
    slices,
    decisions,
    state,
  };
}

function loadContext(config: Config, bundle: object): void {
  const b = bundle as any;
  if (b.slices) {
    for (const s of b.slices) saveSlice(config, s);
  }
  if (b.decisions) {
    for (const d of b.decisions) saveDecision(config, d);
  }
  if (b.state) saveState(config, b.state);
}

async function ask(question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  process.stdout.write(prompt);
  for await (const line of console) {
    const ans = line.trim();
    return ans || defaultVal || "";
  }
  return "";
}

async function askMulti(question: string): Promise<string[]> {
  console.log(`${question} (逐行输入，空行结束):`);
  const items: string[] = [];
  for await (const line of console) {
    const trimmed = line.trim();
    if (!trimmed) break;
    items.push(trimmed);
  }
  return items;
}

async function cmdInit(config: Config): Promise<void> {
  ensureContextDir(config);
  console.log(`✓ 初始化完成: ${getContextDir(config)}`);
}

async function cmdSliceDefine(config: Config, name: string): Promise<void> {
  if (loadSlice(config, name)) {
    console.error(`切片 "${name}" 已存在`);
    process.exit(1);
  }
  console.log(`\n=== 定义切片: ${name} ===\n`);

  const description = await ask("切片描述（一句话）");
  console.log("\n-- 契约定义 --");
  const inputs = await askMulti("输入参数/事件（每行一个）");
  const outputs = await askMulti("输出/返回（每行一个）");
  const sideEffects = await askMulti("副作用（写DB、发事件、发邮件等，每行一个）");
  const invariants = await askMulti("不变量/业务规则（每行一个）");

  console.log("\n-- 数据层 --");
  const tables = await askMulti("涉及的数据表（每行一个）");
  const reads = await askMulti("读操作（表.字段或查询名，每行一个）");
  const writes = await askMulti("写操作（表.字段或命令名，每行一个）");

  console.log("\n-- 路由/接口 --");
  const routes = await askMulti("HTTP 路由或 gRPC 方法（每行一个，如 GET /api/users）");

  console.log("\n-- 依赖 --");
  const internal = await askMulti("内部依赖（其他切片名，每行一个）");
  const external = await askMulti("外部依赖（第三方服务、中间件等，每行一个）");

  console.log("\n-- 验收标准 --");
  const acceptance = await askMulti("验收条件（每行一个，建议 Given/When/Then 格式）");

  const slice: Slice = {
    name,
    description,
    contract: { inputs, outputs, sideEffects, invariants },
    data: { tables, reads, writes },
    routes,
    dependencies: { internal, external },
    acceptance,
    state: "defined",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  console.log("\n=== 预览 ===");
  console.log(JSON.stringify(slice, null, 2));
  const confirm = await ask("\n确认保存？(y/N)", "n");
  if (confirm.toLowerCase() === "y") {
    saveSlice(config, slice);
    console.log(`✓ 切片 "${name}" 已保存`);
  } else {
    console.log("已取消");
  }
}

async function cmdSliceList(config: Config): Promise<void> {
  const slices = listSlices(config);
  if (slices.length === 0) {
    console.log("暂无切片");
    return;
  }
  console.log("\n切片列表:");
  for (const s of slices) {
    console.log(`  ${s.name.padEnd(30)} ${s.state.padEnd(16)} ${s.description}`);
  }
}

async function cmdSliceStatus(config: Config, name: string, newState?: string): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  if (!newState) {
    console.log(`当前状态: ${slice.state}`);
    return;
  }
  if (!config.defaultStates.includes(newState)) {
    console.error(`无效状态: ${newState}。可用: ${config.defaultStates.join(", ")}`);
    process.exit(1);
  }
  slice.state = newState;
  slice.updatedAt = nowISO();
  saveSlice(config, slice);
  console.log(`✓ 切片 "${name}" 状态更新为: ${newState}`);
}

async function cmdSliceShow(config: Config, name: string): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  console.log(JSON.stringify(slice, null, 2));
}

async function cmdDecisionAdd(config: Config, id: string): Promise<void> {
  console.log(`\n=== 记录决策: ${id} ===\n`);
  const slug = await ask("Slug（用于文件名，如 runtime-choice）", slugify(id));
  const title = await ask("标题");
  const context = await ask("背景/上下文");
  console.log("\n备选方案（每行格式：方案名|优点|缺点，空行结束）:");
  const alternatives: Decision["alternatives"] = [];
  for await (const line of console) {
    const trimmed = line.trim();
    if (!trimmed) break;
    const [option, pros, cons] = trimmed.split("|");
    alternatives.push({
      option: option.trim(),
      pros: pros ? pros.split(",").map(p => p.trim()) : [],
      cons: cons ? cons.split(",").map(c => c.trim()) : [],
    });
  }
  const decision = await ask("最终决策");
  const consequences = await askMulti("后果/影响（每行一个）");
  const relatedSlices = await askMulti("关联切片（每行一个）");

  const dec: Decision = {
    id,
    slug,
    title,
    status: "accepted",
    context,
    alternatives,
    decision,
    consequences,
    relatedSlices,
    createdAt: nowISO(),
  };

  console.log("\n=== 预览 ===");
  console.log(`ID: ${dec.id}`);
  console.log(`标题: ${dec.title}`);
  console.log(`决策: ${dec.decision}`);
  const confirm = await ask("\n确认保存？(y/N)", "n");
  if (confirm.toLowerCase() === "y") {
    saveDecision(config, dec);
    console.log(`✓ 决策 "${id}" 已保存`);
  } else {
    console.log("已取消");
  }
}

async function cmdDecisionList(config: Config): Promise<void> {
  const decisions = listDecisions(config);
  if (decisions.length === 0) {
    console.log("暂无决策记录");
    return;
  }
  console.log("\n决策列表:");
  for (const d of decisions) {
    console.log(`  ${d.id.padEnd(12)} ${d.title.padEnd(30)} [${d.status}]`);
  }
}

async function cmdDecisionShow(config: Config, id: string): Promise<void> {
  const decisions = listDecisions(config);
  const dec = decisions.find(d => d.id === id);
  if (!dec) {
    console.error(`决策 "${id}" 不存在`);
    process.exit(1);
  }
  const p = decisionPath(config, dec.id, dec.slug);
  console.log(readFileSync(p, "utf-8"));
}

async function cmdContextDump(config: Config, output?: string): Promise<void> {
  const bundle = dumpContext(config);
  const json = JSON.stringify(bundle, null, 2);
  if (output) {
    writeFileSync(resolve(PROJECT_ROOT, output), json);
    console.log(`✓ 上下文包已导出到: ${output}`);
  } else {
    console.log(json);
  }
}

async function cmdContextLoad(config: Config, file: string): Promise<void> {
  const p = resolve(PROJECT_ROOT, file);
  if (!existsSync(p)) {
    console.error(`文件不存在: ${file}`);
    process.exit(1);
  }
  const bundle = JSON.parse(readFileSync(p, "utf-8"));
  loadContext(config, bundle);
  console.log(`✓ 上下文已从 ${file} 恢复`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  ensureContextDir(config);

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
用法: mck <subcommand> [args]

子命令:
  init                          初始化上下文目录
  slice define <name>           交互式定义切片
  slice list                    列出所有切片
  slice status <name> [state]   查看/更新切片状态
  slice show <name>             显示切片详情
  decision add <id>             记录架构决策
  decision list                 列出所有决策
  decision show <id>            显示决策详情
  context dump [output]         导出上下文包（JSON）
  context load <file>           从包恢复上下文
`);
    process.exit(0);
  }

  const [sub, ...rest] = args;

  try {
    switch (sub) {
      case "init":
        await cmdInit(config);
        break;
      case "slice":
        switch (rest[0]) {
          case "define": await cmdSliceDefine(config, rest[1]); break;
          case "list": await cmdSliceList(config); break;
          case "status": await cmdSliceStatus(config, rest[1], rest[2]); break;
          case "show": await cmdSliceShow(config, rest[1]); break;
          default: console.error(`未知 slice 子命令: ${rest[0]}`); process.exit(1);
        }
        break;
      case "decision":
        switch (rest[0]) {
          case "add": await cmdDecisionAdd(config, rest[1]); break;
          case "list": await cmdDecisionList(config); break;
          case "show": await cmdDecisionShow(config, rest[1]); break;
          default: console.error(`未知 decision 子命令: ${rest[0]}`); process.exit(1);
        }
        break;
      case "context":
        switch (rest[0]) {
          case "dump": await cmdContextDump(config, rest[1]); break;
          case "load": await cmdContextLoad(config, rest[1]); break;
          default: console.error(`未知 context 子命令: ${rest[0]}`); process.exit(1);
        }
        break;
      default:
        console.error(`未知子命令: ${sub}`);
        process.exit(1);
    }
  } catch (e) {
    console.error("错误:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();