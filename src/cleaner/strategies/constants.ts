/* eslint-disable @typescript-eslint/naming-convention */
/** Strategy identifiers, used as the `strategy` metric label. */
export const StrategyName = {
  TILES_DELETION: 'tiles_deletion',
  DELETE_STORED_RESOURCES: 'delete_stored_resources',
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

/** Strategy label used when a task fails before its strategy is resolved. */
export const UNKNOWN_STRATEGY = 'unknown';

export type StrategyName = (typeof StrategyName)[keyof typeof StrategyName];
