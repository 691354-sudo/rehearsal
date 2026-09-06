import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps paid provider keys explicitly empty after loading the browser environment", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "echo-browser-env-"));
  try {
    const env = path.join(dir, "browser.env");
    writeFileSync(env, "OPENAI_API_KEY=fixture\nELEVENLABS_API_KEY=fixture\n");
    writeFileSync(path.join(dir, "npm"), '#!/usr/bin/env bash\n[[ ${OPENAI_API_KEY+x} == x && -z "$OPENAI_API_KEY" && ${ELEVENLABS_API_KEY+x} == x && -z "$ELEVENLABS_API_KEY" && "$DOTENV_CONFIG_PATH" == /dev/null ]]\n', { mode: 0o700 });
    const result = spawnSync("bash", ["scripts/dev-codex.sh"], {
      env: { ...process.env, CODEX_BROWSER_ENV_FILE: env, PATH: `${dir}:${process.env.PATH}` },
    });
    expect(result.status).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
