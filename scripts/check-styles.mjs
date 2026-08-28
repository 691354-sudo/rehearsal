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

if (importedFiles.length !== 15) errors.push(`src/styles/index.css imports ${importedFiles.length} files; expected 15`);

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

const captureSource = sourceByFile.get("capture.css") || "";
const notebookReviewBatchRules = [...captureSource.matchAll(/\.capture-notebook--review\s*>\s*\.simple-review-batch\s*\{([^}]*)\}/g)];
if (!notebookReviewBatchRules.some(([, body]) => /\boverflow:\s*visible\s*;/.test(body))) {
  errors.push("Notebook review batches must expose expanded adjustments to the outer mobile scroll container");
}

const listenSource = sourceByFile.get("listen.css") || "";
const listenPlayerRules = [...listenSource.matchAll(/\.listen-player\s*\{([^}]*)\}/g)];
if (!listenPlayerRules.some(([, body]) => /\boverflow-y:\s*auto\s*;/.test(body))) {
  errors.push("the mobile Listen player must scroll when its controls exceed the available viewport height");
}

const authSource = sourceByFile.get("auth.css") || "";
if (!/\.profile-gate--pilot-theme\s+\.profile-theme-choice button\s*\{[^}]*\bmin-height:\s*44px\s*;/ms.test(authSource)) {
  errors.push("pilot theme controls must keep a 44px minimum touch target after the shared theme button rule");
}

if (errors.length) {
  console.error("Style checks failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Style checks passed: ${importedFiles.length} active imports, no legacy layers, no undefined variables.`);
