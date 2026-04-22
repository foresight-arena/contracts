import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, '..', 'state');

export function getStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  return STATE_DIR;
}

export function loadJSON(filename) {
  const path = join(getStateDir(), filename);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return null; }
}

export function saveJSON(filename, data) {
  writeFileSync(join(getStateDir(), filename), JSON.stringify(data, null, 2));
}

export function getRevealQueue() {
  return loadJSON('reveal-queue.json') || [];
}

export function saveRevealQueue(queue) {
  saveJSON('reveal-queue.json', queue);
}
