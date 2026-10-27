import fs from 'fs';
import path from 'path';

const DEFAULT_RAW_DIR = './raw';
const DEFAULT_DATA_DIR = './data';

let _rawDir = DEFAULT_RAW_DIR;
let _skipCache = false;

export function configureCache({ rawDir, skipCache } = {}) {
  if (rawDir) _rawDir = rawDir;
  if (skipCache !== undefined) _skipCache = skipCache;
}

export function getRawDir() {
  return _rawDir;
}

export function rawDirFor(handle) {
  const safe = handle.replace(/^@/, '');
  return path.join(_rawDir, safe);
}

export function rawPathFor(handle, type) {
  return path.join(rawDirFor(handle), `${type}.json`);
}

export function loadRaw(handle, type) {
  if (_skipCache) return null;
  const p = rawPathFor(handle, type);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

export function saveRaw(handle, type, data) {
  const dir = rawDirFor(handle);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${type}.json`), JSON.stringify(data, null, 2));
}
