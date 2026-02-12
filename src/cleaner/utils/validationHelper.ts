import type { Logger } from '@map-colonies/js-logger';
import type { ZodSchema } from 'zod';
import { container } from 'tsyringe';
import { SERVICES } from '@common/constants';
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
 *
 * @example
 * const validatedParams = validateSchema(
 *   tilesDeletionParamsSchema,
 *   rawParams,
 *   'tiles-deletion'
 * );
 */
export function validateSchema<T>(schema: ZodSchema<T>, params: unknown, taskType: string): T {
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const result = schema.safeParse(params);

  if (!result.success) {
    logger.error({ taskType, errors: result.error.errors }, 'Task parameter validation failed');
    throw new ValidationError(`Invalid parameters for task type: ${taskType}`, result.error.errors);
  }

  logger.debug({ taskType }, 'Task parameters validated successfully');
  return result.data;
}
