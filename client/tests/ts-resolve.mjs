// Resolve hook for the Node test runner: lets tests import app modules that
// use extensionless relative imports and the `@/` alias, as the bundler does.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../src/', import.meta.url);
const SUFFIXES = ['.ts', '.tsx', '/index.ts'];

function baseUrl(specifier, parentURL) {
  if (specifier.startsWith('@/')) {
    return new URL(specifier.slice(2), SRC);
  }
  if (specifier.startsWith('.') && parentURL && path.extname(specifier) === '') {
    return new URL(specifier, parentURL);
  }
  return null;
}

export async function resolve(specifier, context, next) {
  const base = baseUrl(specifier, context.parentURL);
  if (base !== null) {
    for (const suffix of SUFFIXES) {
      const candidate = new URL(base.href + suffix);
      if (existsSync(fileURLToPath(candidate))) {
        return next(candidate.href, context);
      }
    }
  }
  return next(specifier, context);
}
