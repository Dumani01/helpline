import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'dotenv/config';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = process.env.DATABASE_FILE === ':memory:' ? ':memory:' : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.DATABASE_FILE || './soporte.sqlite');
export const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
db.exec(readFileSync(path.join(root, 'schema.sql'), 'utf8'));
export function normalizeUtcDates() {
  for (const [table, columns] of Object.entries({
    tickets: ['fecha_creacion', 'fecha_limite', 'fecha_resolucion'],
    comentarios: ['fecha'],
    historial: ['fecha']
  })) {
    for (const column of columns) {
      db.exec(`UPDATE ${table} SET ${column}=strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) WHERE ${column} IS NOT NULL AND (length(${column}) != 24 OR substr(${column}, 11, 1) != 'T' OR substr(${column}, 20, 1) != '.' OR substr(${column}, 24, 1) != 'Z')`);
    }
  }
}
normalizeUtcDates();
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
