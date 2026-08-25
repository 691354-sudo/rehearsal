import fs from "node:fs";
import path from "node:path";

const stylesDir = path.resolve("src/styles");
const indexPath = path.join(stylesDir, "index.css");
const indexSource = fs.readFileSync(indexPath, "utf8");
const importedFiles = [...indexSource.matchAll(/@import\s+["'](.+?)["'];/g)]
  .map((match) => path.resolve(stylesDir, match[1]));
const forbiddenFiles = new Set([
  "practice.css",
  "unified.css",
  "echo-v7.css",
  "echo-v7-workspaces.css",
  "echo-v7-responsive.css",
]);
const errors = [];

if (importedFiles.length !== 14) errors.push(`src/styles/index.css imports ${importedFiles.length} files; expected 14`);

for (const importedFile of importedFiles) {
  const basename = path.basename(importedFile);
  if (!fs.existsSync(importedFile)) errors.push(`missing CSS import: ${path.relative(process.cwd(), importedFile)}`);
  if (forbiddenFiles.has(basename) || /^echo-v\d.*\.css$/i.test(basename)) errors.push(`forbidden legacy CSS import: ${basename}`);
}

for (const entry of fs.readdirSync(stylesDir)) {
  if (forbiddenFiles.has(entry) || /^echo-v\d.*\.css$/i.test(entry)) errors.push(`forbidden legacy CSS file: src/styles/${entry}`);
}

const cssFiles = fs.readdirSync(stylesDir).filter((entry) => entry.endsWith(".css"));
const definitions = new Set();
const uses = [];
const sourceByFile = new Map();
for (const entry of cssFiles) {
  const source = fs.readFileSync(path.join(stylesDir, entry), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  sourceByFile.set(entry, source);
  for (const match of source.matchAll(/^\s*(--[\w-]+)\s*:/gm)) definitions.add(match[1]);
  for (const match of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    uses.push({ entry, line, name: match[1] });
  }
}

for (const use of uses) {
  if (!definitions.has(use.name)) errors.push(`undefined CSS variable ${use.name} at src/styles/${use.entry}:${use.line}`);
}

const reviewSource = sourceByFile.get("review.css") || "";
if (/(?:^|})\s*\.simple-review-actions\s*\{[^}]*\bgrid-(?:column|row)\s*:/ms.test(reviewSource)) {
  errors.push("review action grid placement must be scoped to its owning parent; a bare .simple-review-actions rule breaks nested mobile forms");
}

if (errors.length) {
  console.error("Style checks failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Style checks passed: ${importedFiles.length} active imports, no legacy layers, no undefined variables.`);
