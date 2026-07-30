import { accessSync, constants, statSync } from 'node:fs';
import type { Logger } from '@map-colonies/js-logger';
import { ConfigurationError, describeError } from '../errors';

export const assertCanDeleteFromFolder = (path: string, logger: Logger): void => {
  try {
    accessSync(path, constants.F_OK | constants.R_OK | constants.W_OK);
    logger.debug({ msg: 'Able to delete from directory', path });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new ConfigurationError(`FS path does not exist: ${path}`);
    } else if (err instanceof Error && 'code' in err && (err.code === 'EACCES' || err.code === 'EPERM')) {
      throw new ConfigurationError(`FS path permission denied for path: ${path}`);
    } else {
      throw new ConfigurationError(`An unexpected error occurred on FS path accessibility check: ${describeError(err)}`);
    }
  }

  try {
    const pathStat = statSync(path);
    if (!pathStat.isDirectory()) {
      throw new ConfigurationError(`FS path exists but it is a file, not a directory: ${path}`);
    }
  } catch (err) {
    if (err instanceof ConfigurationError) throw err;
    throw new ConfigurationError(`An unexpected error occurred on FS info check: ${describeError(err)}`);
  }
};
