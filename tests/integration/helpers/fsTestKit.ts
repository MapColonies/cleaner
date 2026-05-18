import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { TINY_TILE_BODY } from './tileFixtures';

async function makeTempFsBase(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'test-dir'));
}

async function writeTile(basePath: string, relativePath: string): Promise<void> {
  const absolute = join(basePath, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, TINY_TILE_BODY);
}

async function writeManyTiles(basePath: string, relativePaths: string[]): Promise<void> {
  const concurrency = 32;
  for (let i = 0; i < relativePaths.length; i += concurrency) {
    await Promise.all(relativePaths.slice(i, i + concurrency).map(async (path) => writeTile(basePath, path)));
  }
}

function toForwardSlashes(value: string): string {
  return sep === '/' ? value : value.split(sep).join('/');
}

async function listAllFiles(basePath: string): Promise<string[]> {
  const entries = await readdir(basePath, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      const parentPath = (entry as unknown as { parentPath?: string; path?: string }).parentPath ?? (entry as unknown as { path: string }).path;
      const abs = join(parentPath, entry.name);
      files.push(toForwardSlashes(relative(basePath, abs)));
    }
  }
  return files.sort();
}

async function listAllDirs(basePath: string): Promise<string[]> {
  const entries = await readdir(basePath, { recursive: true, withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const parentPath = (entry as unknown as { parentPath?: string; path?: string }).parentPath ?? (entry as unknown as { path: string }).path;
      const abs = join(parentPath, entry.name);
      dirs.push(toForwardSlashes(relative(basePath, abs)));
    }
  }
  return dirs.sort();
}

async function rmBase(basePath: string): Promise<void> {
  await rm(basePath, { recursive: true, force: true });
}

export { makeTempFsBase, writeTile, writeManyTiles, listAllFiles, listAllDirs, rmBase };
