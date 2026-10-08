// Imported FIRST by engine tests: points the SQLite file at a temp dir so tests never touch data/app.db.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.ENGINE_TEST_DATA_DIR) {
  process.env.ENGINE_TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "engine-test-"));
}
process.env.DATA_DIR = process.env.ENGINE_TEST_DATA_DIR;
delete process.env.OPENAI_API_KEY;
