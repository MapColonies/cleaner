import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { tilesDeletionParamsSchema, type TilesDeletionParams } from '../validation/schemas';
import { validateSchema } from '../utils';
import type { ITaskStrategy } from './taskStrategy';

/**
 * Strategy for handling tiles-deletion tasks.
 * Deletes tiles from storage before updating to lower resolution.
 */
@injectable()
export class TilesDeletionStrategy implements ITaskStrategy<TilesDeletionParams> {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  /**
   * Validates task parameters against tiles-deletion schema.
   *
   * @param params - Unknown task parameters to validate
   * @param taskType - Task type from polled task (for logging)
   * @returns Typed and validated tiles deletion parameters
   * @throws ValidationError if parameters fail schema validation
   */
  public validate(params: unknown, taskType: string): TilesDeletionParams {
    return validateSchema(tilesDeletionParamsSchema, params, taskType);
  }

  public async execute(params: TilesDeletionParams): Promise<void> {
    this.logger.info({
      msg: 'Executing tiles deletion task',
      params,
    });

    // TODO: Implement tiles deletion logic
    // 1. Extract tile coordinates/ranges from params
    // 2. Connect to tile storage (S3, filesystem, etc.)
    // 3. Delete tiles in the specified range
    // 4. Handle partial failures (retry logic)
    await Promise.resolve(); // Placeholder for async implementation

    this.logger.info({ msg: 'Tiles deletion task completed' });
  }
}
