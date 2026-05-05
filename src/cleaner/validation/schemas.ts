import { z } from 'zod';

const MAX_ZOOM_LEVEL = 22;

const tileRangeSchema = z.object({
  zoom: z.number().int().min(0).max(MAX_ZOOM_LEVEL),
  minX: z.number().int().min(0),
  maxX: z.number().int().min(0),
  minY: z.number().int().min(0),
  maxY: z.number().int().min(0),
});

const s3TilesDeletionParamsSchema = z.object({
  provider: z.literal('S3'),
  tilesPath: z.string().min(1),
  ranges: z.array(tileRangeSchema).min(1),
  fileExtension: z.string().min(1),
});

const fsTilesDeletionParamsSchema = z.object({
  provider: z.literal('FS'),
  tilesPath: z.string().min(1),
  ranges: z.array(tileRangeSchema).min(1),
  fileExtension: z.string().min(1),
});

export const tilesDeletionParamsSchema = z.discriminatedUnion('provider', [s3TilesDeletionParamsSchema, fsTilesDeletionParamsSchema]);

export type TilesDeletionParams = z.infer<typeof tilesDeletionParamsSchema>;
export type TileRange = z.infer<typeof tileRangeSchema>;
