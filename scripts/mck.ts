#!/usr/bin/env bun
/**
 * migration-context-keeper CLI
 * 通用迁移上下文管理工具
 *
 * 能力：切片定义、架构决策、状态追踪、风险清单、所有权锁、契约验证、交接包、上下文打包/恢复
 * 多机协作：.migration-context/ 提交进项目 git 仓库作为唯一事实源，claim/release 防撞车。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.cwd();
const DEFAULT_CONTEXT_DIR = ".migration-context";
const MACHINE = process.env.MCK_MACHINE || hostname();

const RISK_CATEGORIES = [
  "timing",            // 时序/组合爆炸
  "concurrency",       // 并发/竞态
  "data-history",      // 历史脏数据/格式不兼容
  "implicit-contract", // 隐式契约/未文档化行为
  "environment",       // 环境差异（时区/Unicode/行尾符）
  "combinatorial",     // 组合/集成
  "unknown",           // 未知
] as const;

const ACTIVE_STATES = ["implementing", "contract-test", "shadow", "cutover"];

interface Config {
  contextDir: string;
  defaultStates: string[];
  staleClaimHours: number;
}

interface Risk {
  id: string;
  category: string;
  description: string;
  mitigation: string;
  createdAt: string;
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
  integrationChecks: string[];
  risks: Risk[];
  owner: { machine: string; claimedAt: string } | null;
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
  machines: Record<string, string>; // hostname -> lastActive ISO
  updatedAt: string;
}

// ===== 配置与路径 =====
function loadConfig(): Config {
  const configPath = join(PROJECT_ROOT, ".mckrc.json");
  const defaults = {
    contextDir: DEFAULT_CONTEXT_DIR,
    defaultStates: ["defined", "implementing", "contract-test", "shadow", "cutover", "done", "blocked", "abandoned"],
    staleClaimHours: 4,
  };
  if (existsSync(configPath)) {
    return { ...defaults, ...JSON.parse(readFileSync(configPath, "utf-8")) };
  }
  return defaults;
}

function getContextDir(config: Config): string {
  return join(PROJECT_ROOT, config.contextDir);
}

function ensureContextDir(config: Config): void {
  const ctxDir = getContextDir(config);
  for (const sub of ["slices", "decisions"]) {
    const p = join(ctxDir, sub);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
  const statePath = join(ctxDir, "state.json");
  if (!existsSync(statePath)) {
    saveState(config, {
      currentSlice: null,
      nextActions: [],
      risks: [],
      machines: {},
      updatedAt: new Date().toISOString(),
    });
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// 每次命令都心跳一次，记录本机活跃时间（多机可见）
function touch(config: Config): void {
  const state = loadState(config);
  state.machines[MACHINE] = nowISO();
  saveState(config, state);
}

// ===== Slice =====
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

// ===== Decision =====
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
      return parseDecisionMD(content);
    });
}

function parseDecisionMD(content: string): Decision {
  const fmMatch = content.match(/^---([\s\S]*?)---/);
  const fm = fmMatch ? fmMatch[1] : "";
  const field = (key: string) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
  const arr = (key: string) => {
    const m = fm.match(new RegExp(`^${key}:\\s*\\[([\s\S]*?)\\]`, "m"));
    return m ? m[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : [];
  };
  return {
    id: field("id"),
    slug: field("slug"),
    title: field("title"),
    status: (field("status") as Decision["status"]) || "proposed",
    context: field("context"),
    alternatives: [],
    decision: field("decision"),
    consequences: arr("consequences"),
    relatedSlices: arr("relatedSlices"),
    createdAt: field("createdAt"),
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
  writeFileSync(p, fm + `\n## 背景\n${decision.context}\n\n## 决策\n${decision.decision}\n\n## 后果\n${decision.consequences.map(c => `- ${c}`).join("\n")}\n`);
}

// ===== Global State =====
function statePath(config: Config): string {
  return join(getContextDir(config), "state.json");
}

function loadState(config: Config): GlobalState {
  const p = statePath(config);
  if (!existsSync(p)) {
    return { currentSlice: null, nextActions: [], risks: [], machines: {}, updatedAt: nowISO() };
  }
  const s = JSON.parse(readFileSync(p, "utf-8"));
  s.machines = s.machines || {};
  return s;
}

function saveState(config: Config, state: GlobalState): void {
  writeFileSync(statePath(config), JSON.stringify({ ...state, updatedAt: nowISO() }, null, 2));
}

// ===== Context Bundle =====
function dumpContext(config: Config): object {
  return {
    version: 2,
    exportedAt: nowISO(),
    slices: listSlices(config),
    decisions: listDecisions(config),
    state: loadState(config),
  };
}

function loadContext(config: Config, bundle: any): void {
  if (bundle.slices) for (const s of bundle.slices) saveSlice(config, s);
  if (bundle.decisions) for (const d of bundle.decisions) saveDecision(config, d);
  if (bundle.state) saveState(config, bundle.state);
}

// ===== 交互式输入 =====
async function ask(question: string, defaultVal?: string): Promise<string> {
  process.stdout.write(defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `);
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
    const t = line.trim();
    if (!t) break;
    items.push(t);
  }
  return items;
}

// ===== 命令：init =====
async function cmdInit(config: Config): Promise<void> {
  ensureContextDir(config);
  touch(config);
  console.log(`✓ 初始化完成: ${getContextDir(config)}`);
  console.log(`  机器标识: ${MACHINE}`);
}

// ===== 命令：slice define =====
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

  console.log("\n-- 集成检查点（合并后必须跑什么，每行一个）--");
  const integrationChecks = await askMulti("例如: bun run e2e、契约测试、路由表再生成");

  const slice: Slice = {
    name,
    description,
    contract: { inputs, outputs, sideEffects, invariants },
    data: { tables, reads, writes },
    routes,
    dependencies: { internal, external },
    acceptance,
    integrationChecks,
    risks: [],
    owner: null,
    state: "defined",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  console.log("\n=== 预览 ===");
  console.log(JSON.stringify(slice, null, 2));
  const confirm = await ask("\n确认保存？(y/N)", "n");
  if (confirm.toLowerCase() === "y") {
    saveSlice(config, slice);
    touch(config);
    console.log(`✓ 切片 "${name}" 已保存`);
  } else {
    console.log("已取消");
  }
}

// ===== 命令：slice list =====
async function cmdSliceList(config: Config): Promise<void> {
  const slices = listSlices(config);
  if (slices.length === 0) {
    console.log("暂无切片");
    return;
  }
  console.log("\n切片列表:");
  for (const s of slices) {
    const owner = s.owner ? `[@${s.owner.machine}]` : "";
    console.log(`  ${s.name.padEnd(24)} ${s.state.padEnd(16)} ${owner.padEnd(16)} ${s.description}`);
  }
}

// ===== 命令：slice status =====
async function cmdSliceStatus(config: Config, name: string, newState?: string): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  if (!newState) {
    console.log(`当前状态: ${slice.state}`);
    if (slice.owner) console.log(`负责人: ${slice.owner.machine} (${slice.owner.claimedAt})`);
    console.log(`风险数: ${slice.risks.length}`);
    return;
  }
  if (!config.defaultStates.includes(newState)) {
    console.error(`无效状态: ${newState}。可用: ${config.defaultStates.join(", ")}`);
    process.exit(1);
  }
  slice.state = newState;
  slice.updatedAt = nowISO();
  saveSlice(config, slice);
  touch(config);
  console.log(`✓ 切片 "${name}" 状态更新为: ${newState}`);
}

// ===== 命令：slice show =====
async function cmdSliceShow(config: Config, name: string): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  console.log(JSON.stringify(slice, null, 2));
}

// ===== 命令：slice claim / release（所有权锁）=====
async function cmdSliceClaim(config: Config, name: string, force: boolean, machine?: string): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  const m = machine || MACHINE;
  if (slice.owner) {
    if (slice.owner.machine === m) {
      console.log(`✓ ${name} 已由 ${m} 认领（无需重复）`);
      return;
    }
    if (!force) {
      console.error(`✗ 切片 "${name}" 已被 ${slice.owner.machine} 认领 (${slice.owner.claimedAt})。`);
      console.error(`  若该机器已下线，用 --force 强制覆盖。`);
      process.exit(1);
    }
    console.log(`⚠ 强制覆盖 ${slice.owner.machine} 的认领`);
  }
  slice.owner = { machine: m, claimedAt: nowISO() };
  slice.updatedAt = nowISO();
  saveSlice(config, slice);
  touch(config);
  console.log(`✓ ${m} 已认领切片 "${name}"`);
}

async function cmdSliceRelease(config: Config, name: string, force: boolean): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  if (!slice.owner) {
    console.log(`切片 "${name}" 无认领者，无需释放`);
    return;
  }
  if (slice.owner.machine !== MACHINE && !force) {
    console.error(`✗ 该切片由 ${slice.owner.machine} 认领，你（${MACHINE}）无权释放。用 --force 强制。`);
    process.exit(1);
  }
  slice.owner = null;
  slice.updatedAt = nowISO();
  saveSlice(config, slice);
  touch(config);
  console.log(`✓ 切片 "${name}" 已释放`);
}

// ===== 命令：slice risk add / list =====
async function cmdSliceRiskAdd(config: Config, name: string, category: string, description: string, mitigation?: string): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  if (!(RISK_CATEGORIES as readonly string[]).includes(category)) {
    console.error(`无效类别: ${category}。可用: ${RISK_CATEGORIES.join(", ")}`);
    process.exit(1);
  }
  const mitigationText = mitigation ?? (await ask("缓解方案（可空）"));
  const risk: Risk = {
    id: `${slice.risks.length + 1}`,
    category,
    description,
    mitigation: mitigationText,
    createdAt: nowISO(),
  };
  slice.risks.push(risk);
  slice.updatedAt = nowISO();
  saveSlice(config, slice);
  touch(config);
  console.log(`✓ 切片 "${name}" 新增风险 #${risk.id} [${category}]`);
}

async function cmdSliceRiskList(config: Config, name: string): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  if (slice.risks.length === 0) {
    console.log(`切片 "${name}" 暂无风险记录`);
    return;
  }
  console.log(`\n切片 "${name}" 风险清单:`);
  for (const r of slice.risks) {
    const m = r.mitigation ? ` | 缓解: ${r.mitigation}` : " | ⚠ 无缓解方案";
    console.log(`  #${r.id} [${r.category}] ${r.description}${m}`);
  }
}

// ===== 命令：slice handoff（交接包）=====
async function cmdSliceHandoff(config: Config, name: string, output?: string): Promise<void> {
  const slice = loadSlice(config, name);
  if (!slice) {
    console.error(`切片 "${name}" 不存在`);
    process.exit(1);
  }
  const decisions = listDecisions(config).filter(d => d.relatedSlices.includes(name));
  const state = loadState(config);
  const depStates = slice.dependencies.internal.map(d => ({
    name: d,
    state: loadSlice(config, d)?.state ?? "missing",
  }));

  const bundle = {
    type: "slice-handoff",
    version: 1,
    exportedAt: nowISO(),
    fromMachine: MACHINE,
    slice,
    decisions,
    depStates,
    global: {
      currentSlice: state.currentSlice,
      nextActions: state.nextActions,
      risks: state.risks,
    },
    checklist: [
      `1. 读取本包 → 理解切片契约/验收标准/集成检查点`,
      `2. 检查依赖状态 (depStates)，未就绪的切片先对齐`,
      `3. 认领: /mck slice claim ${name}`,
      `4. 逐条完成 acceptance 中的验收标准`,
      `5. 风险自查: 对照 risks 列表逐条确认，新发现的问题用 "/mck slice risk add ${name} <类别> <描述> <缓解>" 记录`,
      `6. 完成 contract-test → shadow → cutover 后 release`,
    ],
  };

  const json = JSON.stringify(bundle, null, 2);
  if (output) {
    writeFileSync(resolve(PROJECT_ROOT, output), json);
    touch(config);
    console.log(`✓ 交接包已生成: ${output}`);
  } else {
    console.log(json);
  }
}

// ===== 命令：decision add =====
async function cmdDecisionAdd(config: Config, id: string): Promise<void> {
  console.log(`\n=== 记录决策: ${id} ===\n`);
  const slug = await ask("Slug（用于文件名，如 runtime-choice）", slugify(id));
  const title = await ask("标题");
  const context = await ask("背景/上下文");
  console.log("\n备选方案（每行格式：方案名|优点|缺点，空行结束）:");
  const alternatives: Decision["alternatives"] = [];
  for await (const line of console) {
    const t = line.trim();
    if (!t) break;
    const [option, pros, cons] = t.split("|");
    alternatives.push({
      option: option.trim(),
      pros: pros ? pros.split(",").map(p => p.trim()).filter(Boolean) : [],
      cons: cons ? cons.split(",").map(c => c.trim()).filter(Boolean) : [],
    });
  }
  const decision = await ask("最终决策");
  const consequences = await askMulti("后果/影响（每行一个）");
  const relatedSlices = await askMulti("关联切片（每行一个）");

  const dec: Decision = {
    id, slug, title,
    status: "accepted",
    context, alternatives, decision, consequences, relatedSlices,
    createdAt: nowISO(),
  };

  console.log("\n=== 预览 ===");
  console.log(`ID: ${dec.id}\n标题: ${dec.title}\n决策: ${dec.decision}`);
  const confirm = await ask("\n确认保存？(y/N)", "n");
  if (confirm.toLowerCase() === "y") {
    saveDecision(config, dec);
    touch(config);
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
  const dec = listDecisions(config).find(d => d.id === id);
  if (!dec) {
    console.error(`决策 "${id}" 不存在`);
    process.exit(1);
  }
  console.log(readFileSync(decisionPath(config, dec.id, dec.slug), "utf-8"));
}

// ===== 命令：context dump / load =====
async function cmdContextDump(config: Config, output?: string): Promise<void> {
  const json = JSON.stringify(dumpContext(config), null, 2);
  if (output) {
    writeFileSync(resolve(PROJECT_ROOT, output), json);
    touch(config);
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
  loadContext(config, JSON.parse(readFileSync(p, "utf-8")));
  touch(config);
  console.log(`✓ 上下文已从 ${file} 恢复`);
}

// ===== 命令：context check（契约验证 + 健康检查）=====
function findCycle(slices: Slice[]): string[] | null {
  const idx = new Map(slices.map((s, i) => [s.name, i]));
  const visited = new Array(slices.length).fill(0); // 0=未访问 1=在栈 2=完成
  const stack: string[] = [];
  const dfs = (i: number): string[] | null => {
    if (visited[i] === 1) {
      const cut = stack.indexOf(slices[i].name);
      return stack.slice(cut).concat(slices[i].name);
    }
    if (visited[i] === 2) return null;
    visited[i] = 1;
    stack.push(slices[i].name);
    for (const dep of slices[i].dependencies.internal) {
      const j = idx.get(dep);
      if (j !== undefined) {
        const cyc = dfs(j);
        if (cyc) return cyc;
      }
    }
    stack.pop();
    visited[i] = 2;
    return null;
  };
  for (let i = 0; i < slices.length; i++) {
    const cyc = dfs(i);
    if (cyc) return cyc;
  }
  return null;
}

async function cmdContextCheck(config: Config): Promise<void> {
  const slices = listSlices(config);
  const state = loadState(config);
  const issues: { severity: "error" | "warn" | "info"; msg: string }[] = [];
  const now = Date.now();

  // 机器活跃
  const activeMachines = Object.entries(state.machines)
    .map(([m, t]) => `${m}(${(now - new Date(t).getTime()) / 3600000 < 1 ? "活跃" : "离线"})`)
    .join(", ");
  console.log(`\n机器: ${activeMachines || "暂无"}`);

  // 1. 路由冲突
  const routeMap = new Map<string, string[]>();
  for (const s of slices) {
    for (const r of s.routes) {
      const norm = r.trim();
      if (!norm) continue;
      if (!routeMap.has(norm)) routeMap.set(norm, []);
      routeMap.get(norm)!.push(s.name);
    }
  }
  for (const [route, names] of routeMap) {
    if (names.length > 1) issues.push({ severity: "error", msg: `路由冲突: "${route}" 被 ${names.join(", ")} 同时声明` });
  }

  // 2. 写表冲突
  const writeMap = new Map<string, string[]>();
  for (const s of slices) {
    for (const t of s.data.writes) {
      const norm = t.trim();
      if (!norm) continue;
      if (!writeMap.has(norm)) writeMap.set(norm, []);
      writeMap.get(norm)!.push(s.name);
    }
  }
  for (const [table, names] of writeMap) {
    if (names.length > 1) issues.push({ severity: "error", msg: `写冲突: 表 "${table}" 被 ${names.join(", ")} 同时写入` });
  }

  // 3. 缺失依赖
  const sliceNames = new Set(slices.map(s => s.name));
  for (const s of slices) {
    for (const d of s.dependencies.internal) {
      if (!sliceNames.has(d)) issues.push({ severity: "warn", msg: `切片 "${s.name}" 依赖不存在的切片 "${d}"` });
    }
  }

  // 4. 依赖环
  const cycle = findCycle(slices);
  if (cycle) issues.push({ severity: "error", msg: `依赖环: ${cycle.join(" → ")}` });

  // 5. 过期认领
  const staleHours = config.staleClaimHours;
  for (const s of slices) {
    if (s.owner) {
      const age = (now - new Date(s.owner.claimedAt).getTime()) / 3600000;
      if (age > staleHours) {
        issues.push({ severity: "warn", msg: `切片 "${s.name}" 认领可能过期 (${s.owner.machine}, ${age.toFixed(1)}h > ${staleHours}h)` });
      }
    }
  }

  // 6. 活跃但无主
  for (const s of slices) {
    if (ACTIVE_STATES.includes(s.state) && !s.owner) {
      issues.push({ severity: "warn", msg: `切片 "${s.name}" 处于 ${s.state} 但无负责人（建议 claim）` });
    }
  }

  // 7. 已完成但集成检查点待确认
  for (const s of slices) {
    if (s.state === "done" && s.integrationChecks.length > 0) {
      issues.push({ severity: "info", msg: `切片 "${s.name}" 已 done，记得执行集成检查点: ${s.integrationChecks.join("; ")}` });
    }
  }

  // 8. 无缓解方案的风险
  for (const s of slices) {
    for (const r of s.risks) {
      if (!r.mitigation) issues.push({ severity: "info", msg: `切片 "${s.name}" 风险 #${r.id} [${r.category}] 无缓解方案` });
    }
  }

  // 汇总
  const byState: Record<string, number> = {};
  for (const s of slices) byState[s.state] = (byState[s.state] || 0) + 1;
  const summary = Object.entries(byState).map(([k, v]) => `${k}:${v}`).join("  ") || "无切片";
  console.log(`切片状态: ${summary}`);

  if (issues.length === 0) {
    console.log("\n✅ 未发现问题");
    return;
  }

  const errs = issues.filter(i => i.severity === "error");
  const warns = issues.filter(i => i.severity === "warn");
  const infos = issues.filter(i => i.severity === "info");
  console.log(`\n${errs.length} 错误 / ${warns.length} 警告 / ${infos.length} 提示\n`);
  for (const i of issues) {
    const tag = i.severity === "error" ? "✗" : i.severity === "warn" ? "⚠" : "ℹ";
    console.log(`  ${tag} ${i.msg}`);
  }
}

// ===== 主入口 =====
async function main(): Promise<void> {
  const config = loadConfig();
  ensureContextDir(config);

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
用法: mck <subcommand> [args]

切片:
  slice define <name>            交互式定义切片
  slice list                     列出所有切片
  slice show <name>              显示切片详情
  slice status <name> [state]    查看/更新切片状态
  slice claim <name> [--force]   认领切片（所有权锁，防多机撞车）
  slice release <name> [--force] 释放切片
  slice risk add <name> <类别> <描述> --mitigate "..."   记录风险
  slice risk list <name>         列出风险
  slice handoff <name> [out]     生成交接包（喂给新模型/新机器）

决策:
  decision add <id>              记录架构决策
  decision list                  列出所有决策
  decision show <id>             显示决策详情

上下文:
  context check                  契约验证 + 健康检查（路由/写表/依赖环/认领）
  context dump [out]             导出上下文包
  context load <file>            从包恢复上下文

其他:
  init                           初始化上下文目录
`);
    process.exit(0);
  }

  const [sub, ...rest] = args;
  const flags = {
    force: rest.includes("--force"),
    mitigate: (() => {
      const i = rest.indexOf("--mitigate");
      return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined;
    })(),
  };
  const clean = rest.filter(a => !a.startsWith("--"));

  try {
    switch (sub) {
      case "init":
        await cmdInit(config);
        break;
      case "slice":
        switch (clean[0]) {
          case "define": await cmdSliceDefine(config, clean[1]); break;
          case "list": await cmdSliceList(config); break;
          case "show": await cmdSliceShow(config, clean[1]); break;
          case "status": await cmdSliceStatus(config, clean[1], clean[2]); break;
          case "claim": await cmdSliceClaim(config, clean[1], flags.force, clean[2]); break;
          case "release": await cmdSliceRelease(config, clean[1], flags.force); break;
          case "risk":
            switch (clean[1]) {
              case "add": await cmdSliceRiskAdd(config, clean[2], clean[3], clean.slice(4).join(" "), flags.mitigate); break;
              case "list": await cmdSliceRiskList(config, clean[2]); break;
              default: console.error(`未知 risk 子命令: ${clean[1]}`); process.exit(1);
            }
            break;
          case "handoff": await cmdSliceHandoff(config, clean[1], clean[2]); break;
          default: console.error(`未知 slice 子命令: ${clean[0]}`); process.exit(1);
        }
        break;
      case "decision":
        switch (clean[0]) {
          case "add": await cmdDecisionAdd(config, clean[1]); break;
          case "list": await cmdDecisionList(config); break;
          case "show": await cmdDecisionShow(config, clean[1]); break;
          default: console.error(`未知 decision 子命令: ${clean[0]}`); process.exit(1);
        }
        break;
      case "context":
        switch (clean[0]) {
          case "check": await cmdContextCheck(config); break;
          case "dump": await cmdContextDump(config, clean[1]); break;
          case "load": await cmdContextLoad(config, clean[1]); break;
          default: console.error(`未知 context 子命令: ${clean[0]}`); process.exit(1);
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
