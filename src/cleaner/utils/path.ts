import { resolve, sep } from 'node:path/posix';

export const normalizeFolderPath = (path: string): string => {
  return path.endsWith(sep) ? path : `${path}${sep}`;
};

/**
 * Resolves a file system path to an absolute path.
 * Ensures the path is resolved as an absolute path and properly formatted
 * with a leading separator if not already present.
 * @param path - The input path string to normalize
 * @returns An absolute path with proper path separators
 */
export const resolveAbsolutePath = (path: string): string => {
  return resolve(`${path.startsWith(sep) ? '' : sep}${path}`);
};
