#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '..');
const SQL_DIR = path.join(ROOT, 'supabase');

const SIGNAL = /IF\s+NOT\s+EXISTS|DROP\s+\w+(?:\s+\w+)?\s+IF\s+EXISTS|CREATE\s+OR\s+REPLACE|ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i;

const files = (await readdir(SQL_DIR))
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (!files.length) {
  console.error('No supabase/*.sql files found');
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  const text = await readFile(path.join(SQL_DIR, name), 'utf8');
  const code = text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!SIGNAL.test(code)) {
    console.error(`Non-idempotent SQL script: supabase/${name}`);
    failed += 1;
    continue;
  }
  console.log(`OK supabase/${name}`);
}

if (failed) process.exit(1);
