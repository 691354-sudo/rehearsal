import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type RehearsalDatabase } from "../db/database.js";
import { RehearsalRepository } from "../db/repository.js";
import { seedDatabase } from "../db/seed.js";

export type ApiTestContext = {
  tempDir: string;
  databasePath: string;
  db: RehearsalDatabase;
  repository: RehearsalRepository;
  reopen: () => void;
  close: () => void;
};

export const createApiTestContext = (): ApiTestContext => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-test-"));
  const databasePath = path.join(tempDir, "test.sqlite");
  const context = {
    tempDir,
    databasePath,
    db: openDatabase(databasePath),
    repository: null as unknown as RehearsalRepository,
    reopen: () => {
      context.db.close();
      context.db = openDatabase(databasePath);
      context.repository = new RehearsalRepository(context.db);
    },
    close: () => {
      if (context.db.open) context.db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  } satisfies ApiTestContext;
  context.repository = new RehearsalRepository(context.db);
  seedDatabase(context.repository);
  return context;
};
