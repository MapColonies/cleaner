import { inject, injectable } from 'tsyringe';
import { type Logger } from '@map-colonies/js-logger';
import { type z } from 'zod';
import { SERVICES } from '@common/constants';
import { ValidationError } from '../errors';
import { taskSchemas, type TaskType } from './schemas';

/**
 * TaskValidator is responsible for validating task parameters against Zod schemas.
 * Validation failures result in ValidationError (unrecoverable).
 */
@injectable()
export class TaskValidator {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  /**
   * Validates task parameters against the schema for the given task type.
   * @param taskType - The task type (e.g., 'tiles-deletion')
   * @param params - The task parameters to validate
   * @returns The validated and typed parameters
   * @throws ValidationError if validation fails or schema not found
   */
  public validate<T extends TaskType>(taskType: T, params: unknown): z.infer<(typeof taskSchemas)[T]> {
    const schema = taskSchemas[taskType];

    const result = schema.safeParse(params);

    if (!result.success) {
      const message = `Task parameter validation failed for task type: ${taskType}`;
      this.logger.error({ msg: message, errors: result.error.errors });
      throw new ValidationError(message, result.error.errors);
    }

    this.logger.debug({ msg: 'Task parameters validated successfully', taskType });
    return result.data as z.infer<(typeof taskSchemas)[T]>;
  }
}
