import fs from "node:fs";
import path from "node:path";

const limits = new Map([
  [".ts", 450],
  [".tsx", 450],
  [".css", 800],
]);
const roots = ["contracts", "server", "src"];
const violations = [];

const visit = (entryPath) => {
  if (!fs.existsSync(entryPath)) return;
  const stat = fs.statSync(entryPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(entryPath)) visit(path.join(entryPath, entry));
    return;
  }
  if (entryPath.endsWith(".test.ts") || entryPath.endsWith(".test.tsx")) return;
  const extension = path.extname(entryPath);
  const limit = limits.get(extension);
  if (!limit) return;
  const lines = fs.readFileSync(entryPath, "utf8").split(/\r?\n/).length;
  if (lines > limit) violations.push({ entryPath, lines, limit });
};

roots.forEach(visit);

if (violations.length) {
  console.error("Architecture size limits exceeded:");
  for (const { entryPath, lines, limit } of violations) {
    console.error(`- ${entryPath}: ${lines} lines (limit ${limit})`);
  }
  console.error("Split active modules by responsibility. Generated-data exceptions require a documented allowlist entry.");
  process.exit(1);
}

console.log("Architecture limits passed: TypeScript <= 450 lines, CSS <= 800 lines.");
