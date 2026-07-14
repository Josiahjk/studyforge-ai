import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const envPath = path.join(root, ".env");

function readDatabaseUrl() {
  if (!fs.existsSync(envPath)) return "file:./dev.db";
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith("DATABASE_URL="));
  if (!line) return "file:./dev.db";
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

function toSqlitePath(url) {
  if (!url.startsWith("file:")) {
    throw new Error("Only SQLite file: DATABASE_URL values are supported by db:apply.");
  }
  const value = decodeURIComponent(url.slice("file:".length));
  if (value.startsWith("./") || value.startsWith("../")) {
    return path.resolve(root, "prisma", value);
  }
  return path.resolve(value);
}

const dbPath = toSqlitePath(readDatabaseUrl());
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const migrationRoot = path.join(root, "prisma", "migrations");
const migrationFiles = fs
  .readdirSync(migrationRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(migrationRoot, entry.name, "migration.sql"))
  .filter((file) => fs.existsSync(file))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error("No migration SQL files found.");
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(
  "CREATE TABLE IF NOT EXISTS \"_StudyForgeMigration\" (\"id\" TEXT NOT NULL PRIMARY KEY, \"appliedAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);",
);

for (const file of migrationFiles) {
  const id = path.basename(path.dirname(file));
  const applied = db.prepare('SELECT id FROM "_StudyForgeMigration" WHERE id = ?').get(id);
  if (applied) continue;
  const hasBaseSchema = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='User'")
    .get();
  if (id.includes("_init") && hasBaseSchema) {
    db.prepare('INSERT INTO "_StudyForgeMigration" (id) VALUES (?)').run(id);
    continue;
  }
  db.exec(fs.readFileSync(file, "utf8"));
  db.prepare('INSERT INTO "_StudyForgeMigration" (id) VALUES (?)').run(id);
}

db.close();
console.log(`Applied ${migrationFiles.length} migration file(s) to ${dbPath}`);
