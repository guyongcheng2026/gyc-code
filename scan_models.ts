import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OLD_TMP = "./snapshot_old.ts";
const oldSrc = execSync("git show HEAD:src/core/models-dev-snapshot.ts", { encoding: "utf8" });
writeFileSync(OLD_TMP, oldSrc, "utf8");

const oldMod = (await import("./snapshot_old.ts")) as any;
const newMod = (await import("./src/core/models-dev-snapshot.ts")) as any;
const oldObj = JSON.parse(JSON.stringify(oldMod.MODELS_DEV_SNAPSHOT));
const newObj = JSON.parse(JSON.stringify(newMod.MODELS_DEV_SNAPSHOT));

const flat = (obj: Record<string, any>) => {
  const map = new Map<string, any>();
  for (const [pid, prov] of Object.entries(obj)) {
    for (const [mid, mdl] of Object.entries((prov as any).models ?? {})) {
      map.set(`${pid}/${mid}`, mdl);
    }
  }
  return map;
};
const o = flat(oldObj);
const n = flat(newObj);

const added: string[] = [];
const removed: string[] = [];
const changed: string[] = [];
for (const [k, v] of n) if (!o.has(k)) added.push(k);
for (const [k] of o) if (!n.has(k)) removed.push(k);
for (const [k, v] of n) {
  const p = o.get(k);
  if (!p) continue;
  const fields = ["name", "release_date", "last_updated", "status", "cost", "limit", "tool_call", "reasoning"];
  const diffs = fields.filter((f) => JSON.stringify(p[f]) !== JSON.stringify(v[f]));
  if (diffs.length) changed.push(`${k} [${diffs.join(",")}]`);
}

const lines: string[] = [];
lines.push(`供应商: 旧 ${Object.keys(oldObj).length} -> 新 ${Object.keys(newObj).length}`);
lines.push(`模型总数: 旧 ${o.size} -> 新 ${n.size}`);
lines.push(`新增 ${added.length} / 移除 ${removed.length} / 变更 ${changed.length}`);
lines.push("");
lines.push("=== deepseek 提供商（新） ===");
for (const [mid, mdl] of Object.entries((newObj.deepseek as any)?.models ?? {})) {
  lines.push(
    `  - ${mid} | ${mdl.name} | rel=${mdl.release_date} | upd=${mdl.last_updated} | status=${mdl.status ?? "active"} | ctx=${mdl.limit?.context} out=${mdl.limit?.output} | cost=${JSON.stringify(mdl.cost)}`,
  );
}
lines.push("");
lines.push("=== 各提供商最新模型（rel 降序 top2） ===");
for (const [pid, prov] of Object.entries(newObj)) {
  const models = Object.entries((prov as any).models ?? {}) as [string, any][];
  models.sort((a, b) => String(b[1].release_date ?? "").localeCompare(String(a[1].release_date ?? "")));
  const top = models.slice(0, 2).map(([mid, mdl]) => `${mid}(${mdl.release_date})`);
  lines.push(`  ${pid}: ${models.length} 个 | 最新: ${top.join(", ")}`);
}
lines.push("");
lines.push("=== 变更模型明细（前 60） ===");
for (const c of changed.sort().slice(0, 60)) lines.push(`  ~ ${c}`);
lines.push("");
lines.push("=== 移除模型（前 60） ===");
for (const r of removed.sort().slice(0, 60)) lines.push(`  - ${r}`);

writeFileSync("./compare_report.txt", lines.join("\n"), "utf8");
console.log("written compare_report.txt");
