export const normalizeFolderPath = (path: string): string => {
  return path.endsWith('/') ? path : `${path}/`;
};
