import { z } from 'zod';

export const tilesDeletionParamsSchema = z.object({
  //TODO: implement tiles deletion params schema(will be imported from @map-colonies/raster-shared)
});

export type TilesDeletionParams = z.infer<typeof tilesDeletionParamsSchema>;
