import type { Logger } from '@map-colonies/js-logger';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../errors';

/**
 * Generic schema validation helper for task parameters.
 *
 * Validates unknown task parameters against a Zod schema and returns
 * the typed result or throws a ValidationError.
 *
 * Logger is resolved from the DI container, so no need to pass it.
 *
 * @param schema - The Zod schema to validate against
 * @param params - Unknown task parameters to validate
 * @param taskType - Task type name for error messages
 * @returns Typed and validated parameters
 * @throws {ValidationError} If validation fails
 */
export function validateSchema<T>(schema: ZodSchema<T>, params: unknown, logger: Logger): T {
  console.debug('Validating task parameters', { schema: schema.description, params });
  const result = schema.safeParse(params);

  if (!result.success) {
    logger.error({ msg: 'Task parameter validation failed', errors: result.error.errors });
    throw new ValidationError(`Invalid parameters for task`, result.error.errors);
  }

  logger.debug({ msg: 'Task parameters validated successfully' });
  return result.data;
}
