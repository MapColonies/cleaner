/**
 * Simulation script for tiles-deletion tasks.
 *
 * Usage:
 *   node scripts/simulate-deletion.mjs --provider S3
 *   node scripts/simulate-deletion.mjs --provider FS
 *   node scripts/simulate-deletion.mjs --provider S3 --skip-seed   # 1M-tile scale test
 *   node scripts/simulate-deletion.mjs --provider FS --partial      # multi-zoom partial deletion
 *   node scripts/simulate-deletion.mjs --provider S3 --partial      # multi-zoom partial deletion
 *   node scripts/simulate-deletion.mjs --provider FS --real-tiles --source-tile scripts/tile_deletion_test.jpeg
 *   node scripts/simulate-deletion.mjs --provider S3 --real-tiles --source-tile scripts/tile_deletion_test.jpeg --zooms 17,18,19,20 --tile-count 400
 *
 * --real-tiles: seed a real local tile file replicated across a multi-zoom grid.
 *   --source-tile <path>  : local file to use as tile content for every seeded tile (required)
 *   --zooms <z1,z2,...>   : comma-separated zoom levels (default: 17,18,19,20)
 *   --tile-count <N>      : total tiles to seed, distributed evenly across zoom levels (default: 400)
 *   File extension is inferred from the source-tile path (.png or .jpeg).
 *   Each zoom level gets a square grid of ceil(sqrt(N/zooms)) × ceil(sqrt(N/zooms)) tiles
 *   starting at (minX=0, minY=0) so the ranges stay canonical.
 *
 * --skip-seed: skip uploading tiles and go straight to task creation.
 *   Tiles that don't exist are treated as success (NoSuchKey / ENOENT = idempotent).
 *   Use with large ranges to load-test batching, concurrency and progress reporting.
 *   Can also be combined with --real-tiles to skip seeding but still create the job.
 *
 * --partial: seed tiles across three zoom levels and create a task that only
 *   deletes a subset of them. Used to verify that directories containing
 *   surviving tiles are NOT pruned after deletion.
 *
 *   Scenario (zoom base N = ZOOM env var, default 10):
 *     Zoom N   : seed 4×4 grid → task deletes ALL  → dir should be removed
 *     Zoom N+2 : seed 4×4 grid → task deletes half (x=0..1 only) → dir must survive
 *     Zoom N+4 : seed 4×4 grid → task does NOT delete → dir and tiles must survive
 *
 * Scale example (1M tiles, no seeding needed):
 *   MAX_X=999 MAX_Y=999 ZOOM=18 TILES_DELETION_S3_BUCKET=raster-dev \
 *     node scripts/simulate-deletion.mjs --provider S3 --skip-seed
 *
 * Real 100K tile scenario:
 *   MAX_X=99 MAX_Y=999 ZOOM=14 TILES_DELETION_S3_BUCKET=raster-dev \
 *     node scripts/simulate-deletion.mjs --provider S3
 *
 * Override defaults with env vars:
 *   QUEUE_JOB_MANAGER_BASE_URL, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *   TILES_DELETION_S3_BUCKET, TILES_DELETION_FS_BASE_PATH, TILES_PATH, ZOOM, MIN_X, MAX_X, MIN_Y, MAX_Y,
 *   SEED_CONCURRENCY (default: 50)
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  node scripts/simulate-deletion.mjs --provider <S3|FS> [options]

Required:
  --provider <S3|FS>          Storage provider to target

Modes (mutually exclusive):
  --partial                   Seed tiles across 3 zoom levels; task only deletes a subset
  --real-tiles                Use a real tile file instead of fake content
  --skip-seed                 Skip seeding; go straight to job creation (idempotent delete)

Real-tiles options (require --real-tiles):
  --source-tile <path>        Local tile file to replicate across the grid (required)
                              A sample JPEG is bundled at scripts/tile_deletion_test.jpeg
  --zooms <z1,z2,...>         Zoom levels, comma-separated (default: 17,18,19,20)
  --tile-count <N>            Total tiles to seed across all zoom levels (default: 400)

Env vars (all optional — pod ConfigMap values are used automatically):
  QUEUE_JOB_MANAGER_BASE_URL  Job manager endpoint
  S3_ENDPOINT                 S3 endpoint URL
  S3_ACCESS_KEY_ID            S3 access key
  S3_SECRET_ACCESS_KEY        S3 secret key
  TILES_DELETION_S3_BUCKET    S3 bucket name
  TILES_DELETION_FS_BASE_PATH FS base path for tile files
  TILES_PATH                  Relative path prefix for tiles (default: simulate/layer/v1)
  ZOOM                        Zoom level (default: 10)
  MIN_X, MAX_X                X tile range (default: 0..3)
  MIN_Y, MAX_Y                Y tile range (default: 0..3)
  SEED_CONCURRENCY            Upload concurrency (default: 200)

Examples:
  node scripts/simulate-deletion.mjs --provider S3 --skip-seed
  node scripts/simulate-deletion.mjs --provider FS --partial
  node scripts/simulate-deletion.mjs --provider S3 --real-tiles --source-tile scripts/tile_deletion_test.jpeg
  node scripts/simulate-deletion.mjs --provider FS --real-tiles --source-tile scripts/tile_deletion_test.jpeg
  MAX_X=999 MAX_Y=999 ZOOM=18 node scripts/simulate-deletion.mjs --provider S3 --skip-seed
`);
  process.exit(0);
}

const providerFlag = args[args.indexOf('--provider') + 1];
if (!providerFlag || !['S3', 'FS'].includes(providerFlag)) {
  console.error('Usage: node scripts/simulate-deletion.mjs --provider <S3|FS> [--skip-seed] [--partial]');
  console.error(
    '       node scripts/simulate-deletion.mjs --provider <S3|FS> --real-tiles --source-tile <path> [--zooms <z1,z2,...>] [--tile-count <N>]'
  );
  console.error('\nRun with --help for full usage information.');
  process.exit(1);
}
const PROVIDER = providerFlag;
const SKIP_SEED = args.includes('--skip-seed');
const PARTIAL = args.includes('--partial');
const REAL_TILES = args.includes('--real-tiles');

// real-tiles specific args
const SOURCE_TILE = args.includes('--source-tile') ? args[args.indexOf('--source-tile') + 1] : null;
const ZOOMS_INPUT = args.includes('--zooms') ? args[args.indexOf('--zooms') + 1] : '17,18,19,20';
const TILE_COUNT = args.includes('--tile-count') ? Number(args[args.indexOf('--tile-count') + 1]) : 400;

if (REAL_TILES) {
  if (!SOURCE_TILE) {
    console.error('--real-tiles requires --source-tile <path>');
    process.exit(1);
  }
  if (!existsSync(SOURCE_TILE)) {
    console.error(`--source-tile: file not found: ${resolve(SOURCE_TILE)}`);
    process.exit(1);
  }
}

// ─── Read local.json as config base (env vars override) ──────────────────────

let localConfig = {};
try {
  const localPath = resolve(__dirname, '../config/local.json');
  localConfig = JSON.parse(readFileSync(localPath, 'utf8'));
  console.log('[config] Loaded config/local.json');
} catch {
  console.log('[config] config/local.json not found — using env vars / defaults');
}

const cfg = {
  s3: localConfig.s3 ?? {},
  strategies: localConfig.strategies?.tilesDeletion ?? {},
  queue: localConfig.queue ?? {},
};

const JOB_MANAGER_URL =
  process.env.QUEUE_JOB_MANAGER_BASE_URL ??
  cfg.queue.jobManagerBaseUrl ??
  'https://common-job-manager-route-raster-dev.apps.j1lk3njp.eastus.aroapp.io';
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? cfg.s3.endpoint ?? 'http://localhost:9000';
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? cfg.s3.accessKeyId ?? 'minioadmin';
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? cfg.s3.secretAccessKey ?? 'minioadmin';
const S3_BUCKET = process.env.TILES_DELETION_S3_BUCKET ?? cfg.strategies.s3Bucket ?? '';
const FS_BASE_PATH = process.env.TILES_DELETION_FS_BASE_PATH ?? cfg.strategies.fsBasePath ?? '/tiles';
const SEED_CONCURRENCY = Number(process.env.SEED_CONCURRENCY ?? 200);

// Tile range to seed + delete
const TILES_PATH = process.env.TILES_PATH ?? 'simulate/layer/v1';
const ZOOM = Number(process.env.ZOOM ?? 10);
const MIN_X = Number(process.env.MIN_X ?? 0);
const MAX_X = Number(process.env.MAX_X ?? 3);
const MIN_Y = Number(process.env.MIN_Y ?? 0);
const MAX_Y = Number(process.env.MAX_Y ?? 3);
const FILE_EXTENSION = 'jpeg';

// ─── Partial-deletion scenario definition ────────────────────────────────────
//
// Three zoom levels are seeded identically (4×4 grid by default).
// The task only covers zooms 0 and 1 (and zoom 1 only partially), so:
//   partialZooms[0] → fully deleted  → directory should be pruned
//   partialZooms[1] → half deleted   → directory must survive (tiles remain)
//   partialZooms[2] → not in task    → directory must survive (untouched)

const partialZooms = [ZOOM, ZOOM + 2, ZOOM + 4];

// Within zoom[1] we only delete x=[MIN_X .. MID_X], leaving x=[MID_X+1 .. MAX_X]
const MID_X = Math.floor((MIN_X + MAX_X) / 2);

// ─── Tile path helpers ────────────────────────────────────────────────────────

function* tilePaths() {
  for (let x = MIN_X; x <= MAX_X; x++) {
    for (let y = MIN_Y; y <= MAX_Y; y++) {
      yield `${TILES_PATH}/${ZOOM}/${x}/${y}.${FILE_EXTENSION}`;
    }
  }
}

function* tilePathsForZoom(zoom) {
  for (let x = MIN_X; x <= MAX_X; x++) {
    for (let y = MIN_Y; y <= MAX_Y; y++) {
      yield `${TILES_PATH}/${zoom}/${x}/${y}.${FILE_EXTENSION}`;
    }
  }
}

function* allPartialTilePaths() {
  for (const zoom of partialZooms) {
    yield* tilePathsForZoom(zoom);
  }
}

const tileCount = (MAX_X - MIN_X + 1) * (MAX_Y - MIN_Y + 1);
const partialTileCount = tileCount * partialZooms.length;

// ─── S3 seeding ──────────────────────────────────────────────────────────────

async function seedS3Paths(client, paths, label) {
  const keys = [...paths];
  let uploaded = 0;
  for (let i = 0; i < keys.length; i += SEED_CONCURRENCY) {
    const batch = keys.slice(i, i + SEED_CONCURRENCY);
    await Promise.all(
      batch.map((key) => client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: Buffer.from('fake-tile'), ContentType: 'image/png' })))
    );
    uploaded += batch.length;
    if (uploaded % 5000 === 0 || uploaded === keys.length) {
      const pct = Math.round((uploaded / keys.length) * 100);
      console.log(`[S3] ${label}: ${uploaded.toLocaleString()} / ${keys.length.toLocaleString()} (${pct}%)`);
    }
  }
}

async function seedS3() {
  if (!S3_BUCKET) {
    throw new Error('S3_BUCKET env var is required for S3 provider (or set it in the script)');
  }

  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    forcePathStyle: true,
    region: 'us-east-1',
    tls: false,
  });

  if (PARTIAL) {
    console.log(`[S3] Seeding ${partialTileCount.toLocaleString()} tiles across zooms ${partialZooms.join(', ')} (concurrency: ${SEED_CONCURRENCY})`);
    await seedS3Paths(client, allPartialTilePaths(), 'uploaded');
    const firstKey = `${TILES_PATH}/${partialZooms[0]}/${MIN_X}/${MIN_Y}.${FILE_EXTENSION}`;
    await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: firstKey }));
    console.log(`[S3] Verified: s3://${S3_BUCKET}/${firstKey} exists`);
    console.log(`[S3] Done — ${partialTileCount.toLocaleString()} tiles seeded across ${partialZooms.length} zoom levels.\n`);
  } else {
    console.log(`[S3] Seeding ${tileCount.toLocaleString()} tiles to s3://${S3_BUCKET}/${TILES_PATH}/... (concurrency: ${SEED_CONCURRENCY})`);
    await seedS3Paths(client, tilePaths(), 'uploaded');
    const firstKey = `${TILES_PATH}/${ZOOM}/${MIN_X}/${MIN_Y}.${FILE_EXTENSION}`;
    await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: firstKey }));
    console.log(`[S3] Verified: s3://${S3_BUCKET}/${firstKey} exists`);
    console.log(`[S3] Done — ${tileCount.toLocaleString()} tiles seeded.\n`);
  }
}

// ─── FS seeding ───────────────────────────────────────────────────────────────

function writeFsPaths(paths) {
  for (const relativePath of paths) {
    const fullPath = join(FS_BASE_PATH, relativePath);
    const dir = join(FS_BASE_PATH, relativePath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, 'fake-tile');
  }
}

function seedFs() {
  if (PARTIAL) {
    console.log(`[FS] Seeding ${partialTileCount} tiles across zooms ${partialZooms.join(', ')} to ${FS_BASE_PATH}/${TILES_PATH}/...`);
    writeFsPaths(allPartialTilePaths());
    const firstPath = join(FS_BASE_PATH, `${TILES_PATH}/${partialZooms[0]}/${MIN_X}/${MIN_Y}.${FILE_EXTENSION}`);
    if (!existsSync(firstPath)) throw new Error(`Seeding failed — ${firstPath} not found`);
    console.log(`[FS] Verified: ${firstPath} exists`);
    console.log(`[FS] Done — ${partialTileCount} tiles seeded across ${partialZooms.length} zoom levels.\n`);
  } else {
    console.log(`[FS] Seeding ${tileCount} tiles to ${FS_BASE_PATH}/${TILES_PATH}/...`);
    writeFsPaths(tilePaths());
    const firstPath = join(FS_BASE_PATH, `${TILES_PATH}/${ZOOM}/${MIN_X}/${MIN_Y}.${FILE_EXTENSION}`);
    if (!existsSync(firstPath)) throw new Error(`Seeding failed — ${firstPath} not found`);
    console.log(`[FS] Verified: ${firstPath} exists`);
    console.log(`[FS] Done — ${tileCount} tiles seeded.\n`);
  }
}

// ─── Job creation ─────────────────────────────────────────────────────────────

function buildRanges() {
  if (!PARTIAL) {
    return [{ zoom: ZOOM, minX: MIN_X, maxX: MAX_X, minY: MIN_Y, maxY: MAX_Y }];
  }

  // Zoom[0]: full range → all tiles deleted → dir should be pruned
  // Zoom[1]: partial range (x up to MID_X only) → remaining tiles survive → dir must NOT be pruned
  // Zoom[2]: omitted from task entirely → completely untouched
  return [
    { zoom: partialZooms[0], minX: MIN_X, maxX: MAX_X, minY: MIN_Y, maxY: MAX_Y },
    { zoom: partialZooms[1], minX: MIN_X, maxX: MID_X, minY: MIN_Y, maxY: MAX_Y },
  ];
}

function printPartialExpectations() {
  const fullDeletedTiles = tileCount;
  const partialDeletedTiles = (MID_X - MIN_X + 1) * (MAX_Y - MIN_Y + 1);
  const partialRemainingTiles = (MAX_X - MID_X) * (MAX_Y - MIN_Y + 1);

  console.log('\n[Partial] Expected state after the cleaner runs:');
  console.log(`  Zoom ${partialZooms[0]} — ${fullDeletedTiles} tiles DELETED   → zoom dir should be REMOVED`);
  console.log(
    `  Zoom ${partialZooms[1]} — ${partialDeletedTiles} tiles deleted, ${partialRemainingTiles} tiles REMAIN (x=${MID_X + 1}..${MAX_X}) → zoom dir must SURVIVE`
  );
  console.log(`  Zoom ${partialZooms[2]} — ${tileCount} tiles untouched (not in task)     → zoom dir must SURVIVE`);
  console.log('');

  if (PROVIDER === 'FS') {
    console.log('[Partial] After the cleaner completes, verify manually:');
    console.log(`  Should NOT exist : ${FS_BASE_PATH}/${TILES_PATH}/${partialZooms[0]}/`);
    console.log(`  Should     exist : ${FS_BASE_PATH}/${TILES_PATH}/${partialZooms[1]}/`);
    console.log(`  Should     exist : ${FS_BASE_PATH}/${TILES_PATH}/${partialZooms[2]}/`);
  }
  console.log('');
}

async function createJob() {
  const ranges = buildRanges();
  const taskParameters = {
    sourceProvider: PROVIDER,
    tilesPath: TILES_PATH,
    ranges,
    fileExtension: FILE_EXTENSION,
  };

  const body = {
    resourceId: `simulate-${PROVIDER.toLowerCase()}-${Date.now()}`,
    version: '1.0.0',
    type: 'Ingestion_Update',
    parameters: {},
    domain: 'RASTER',
    tasks: [
      {
        type: 'tiles-deletion',
        parameters: taskParameters,
      },
    ],
  };

  console.log('[Job] Creating job with task parameters:');
  console.log(JSON.stringify(taskParameters, null, 2));

  const res = await fetch(`${JOB_MANAGER_URL}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Job creation failed [${res.status}]: ${text}`);
  }

  const { id: jobId, taskIds } = await res.json();

  const deletedCount = PARTIAL ? tileCount + (MID_X - MIN_X + 1) * (MAX_Y - MIN_Y + 1) : tileCount;

  console.log(`\n[Job] Created successfully:`);
  console.log(`  Job ID  : ${jobId}`);
  console.log(`  Task ID : ${taskIds[0]}`);
  console.log(`\nStart the cleaner — it will pick up task "${taskIds[0]}" and delete ${deletedCount} tiles.`);
  console.log(`Track progress: GET ${JOB_MANAGER_URL}/jobs/${jobId}?shouldReturnTasks=true`);

  if (PARTIAL) {
    printPartialExpectations();
  }
}

// ─── Real-tiles mode ──────────────────────────────────────────────────────────

const CONTENT_TYPE_BY_EXT = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg' };

function parseZoomList(input) {
  const zooms = input
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);
  if (zooms.length === 0) {
    throw new Error(`--zooms: invalid zoom list "${input}" — expected comma-separated non-negative integers (e.g. 17,18,19,20)`);
  }
  return zooms;
}

// Compute a square grid that covers at least (totalCount / zoomCount) tiles per zoom.
function gridFromCount(totalCount, zoomCount) {
  const perZoom = Math.ceil(totalCount / zoomCount);
  const dim = Math.ceil(Math.sqrt(perZoom));
  return { minX: 0, maxX: dim - 1, minY: 0, maxY: dim - 1 };
}

function* realTileRelativePaths(zooms, grid, tilesPath, ext) {
  for (const zoom of zooms) {
    for (let x = grid.minX; x <= grid.maxX; x++) {
      for (let y = grid.minY; y <= grid.maxY; y++) {
        yield `${tilesPath}/${zoom}/${x}/${y}.${ext}`;
      }
    }
  }
}

async function seedS3RealTiles(zooms, grid, tilesPath, ext, tileBuffer, contentType) {
  if (!S3_BUCKET) {
    throw new Error('S3_BUCKET env var is required for S3 provider (or set it in config/local.json)');
  }

  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    forcePathStyle: true,
    region: 'us-east-1',
    tls: false,
  });

  const paths = [...realTileRelativePaths(zooms, grid, tilesPath, ext)];
  console.log(
    `[S3] Seeding ${paths.length.toLocaleString()} real tiles across zooms ${zooms.join(', ')} to s3://${S3_BUCKET}/${tilesPath}/... (concurrency: ${SEED_CONCURRENCY})`
  );

  let uploaded = 0;
  for (let i = 0; i < paths.length; i += SEED_CONCURRENCY) {
    const batch = paths.slice(i, i + SEED_CONCURRENCY);
    await Promise.all(
      batch.map((key) => client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: tileBuffer, ContentType: contentType })))
    );
    uploaded += batch.length;
    if (uploaded % 1000 === 0 || uploaded === paths.length) {
      const pct = Math.round((uploaded / paths.length) * 100);
      console.log(`[S3] uploaded: ${uploaded.toLocaleString()} / ${paths.length.toLocaleString()} (${pct}%)`);
    }
  }

  const firstKey = paths[0];
  await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: firstKey }));
  console.log(`[S3] Verified: s3://${S3_BUCKET}/${firstKey} exists`);
  console.log(`[S3] Done.\n`);
}

function seedFsRealTiles(zooms, grid, tilesPath, ext, tileBuffer) {
  const paths = [...realTileRelativePaths(zooms, grid, tilesPath, ext)];
  console.log(`[FS] Seeding ${paths.length.toLocaleString()} real tiles across zooms ${zooms.join(', ')} to ${FS_BASE_PATH}/${tilesPath}/...`);

  for (const relativePath of paths) {
    const fullPath = join(FS_BASE_PATH, relativePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, tileBuffer);
  }

  const firstPath = join(FS_BASE_PATH, paths[0]);
  if (!existsSync(firstPath)) throw new Error(`Seeding failed — ${firstPath} not found`);
  console.log(`[FS] Verified: ${firstPath} exists`);
  console.log(`[FS] Done.\n`);
}

async function createRealTilesJob(zooms, grid, tilesPath, ext) {
  const ranges = zooms.map((zoom) => ({ zoom, minX: grid.minX, maxX: grid.maxX, minY: grid.minY, maxY: grid.maxY }));
  const taskParameters = {
    sourceProvider: PROVIDER,
    tilesPath,
    ranges,
    fileExtension: ext,
  };

  const body = {
    resourceId: `simulate-real-${PROVIDER.toLowerCase()}-${Date.now()}`,
    version: '1.0.0',
    type: 'Ingestion_Update',
    parameters: {},
    domain: 'RASTER',
    tasks: [{ type: 'tiles-deletion', parameters: taskParameters }],
  };

  console.log('[Job] Creating job with task parameters:');
  console.log(JSON.stringify(taskParameters, null, 2));

  const res = await fetch(`${JOB_MANAGER_URL}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Job creation failed [${res.status}]: ${text}`);
  }

  const { id: jobId, taskIds } = await res.json();
  const totalTiles = zooms.length * (grid.maxX - grid.minX + 1) * (grid.maxY - grid.minY + 1);

  console.log(`\n[Job] Created successfully:`);
  console.log(`  Job ID  : ${jobId}`);
  console.log(`  Task ID : ${taskIds[0]}`);
  console.log(`\nStart the cleaner — it will pick up task "${taskIds[0]}" and delete ${totalTiles.toLocaleString()} tiles.`);
  console.log(`Track progress: GET ${JOB_MANAGER_URL}/jobs/${jobId}?shouldReturnTasks=true`);
}

async function runRealTilesMode() {
  const zooms = parseZoomList(ZOOMS_INPUT);
  const ext = extname(SOURCE_TILE).slice(1).toLowerCase() || FILE_EXTENSION;
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
  const tileBuffer = readFileSync(SOURCE_TILE);
  const grid = gridFromCount(TILE_COUNT, zooms.length);
  const tilesPerZoom = (grid.maxX - grid.minX + 1) * (grid.maxY - grid.minY + 1);
  const totalSeeded = tilesPerZoom * zooms.length;

  console.log(`[real-tiles] Source tile : ${resolve(SOURCE_TILE)} (${tileBuffer.length.toLocaleString()} bytes, .${ext})`);
  console.log(`[real-tiles] Zooms       : ${zooms.join(', ')}`);
  console.log(`[real-tiles] Grid/zoom   : ${grid.minX}..${grid.maxX} × ${grid.minY}..${grid.maxY} = ${tilesPerZoom} tiles`);
  console.log(`[real-tiles] Total tiles : ${totalSeeded.toLocaleString()} (${zooms.length} zoom levels × ${tilesPerZoom})\n`);

  if (!SKIP_SEED) {
    if (PROVIDER === 'S3') {
      await seedS3RealTiles(zooms, grid, TILES_PATH, ext, tileBuffer, contentType);
    } else {
      seedFsRealTiles(zooms, grid, TILES_PATH, ext, tileBuffer);
    }
  } else {
    console.log(`[seed] Skipped — non-existent tiles are treated as success (idempotent delete).\n`);
  }

  await createRealTilesJob(zooms, grid, TILES_PATH, ext);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (REAL_TILES) {
    const zooms = parseZoomList(ZOOMS_INPUT);
    const ext = extname(SOURCE_TILE).slice(1).toLowerCase() || FILE_EXTENSION;
    const grid = gridFromCount(TILE_COUNT, zooms.length);
    const tilesPerZoom = (grid.maxX - grid.minX + 1) * (grid.maxY - grid.minY + 1);
    const totalSeeded = tilesPerZoom * zooms.length;
    console.log(
      `\n=== Simulating tiles-deletion | provider: ${PROVIDER} | mode: real-tiles | zooms: ${zooms.join(',')} | tiles: ~${totalSeeded.toLocaleString()} | seed: ${SKIP_SEED ? 'skipped' : 'yes'} ===\n`
    );
    await runRealTilesMode();
    return;
  }

  const modeLabel = PARTIAL ? 'multi-zoom partial' : 'single-zoom full';
  const seedCount = PARTIAL ? partialTileCount : tileCount;
  console.log(
    `\n=== Simulating tiles-deletion | sourceProvider: ${PROVIDER} | mode: ${modeLabel} | tiles: ${seedCount.toLocaleString()} | seed: ${SKIP_SEED ? 'skipped' : 'yes'} ===\n`
  );

  if (!SKIP_SEED) {
    if (PROVIDER === 'S3') {
      await seedS3();
    } else {
      seedFs();
    }
  } else {
    console.log(`[seed] Skipped — non-existent tiles are treated as success (idempotent delete).\n`);
  }

  await createJob();
}

main().catch((err) => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});
