import { vi } from 'vitest';
import type { Logger } from '@map-colonies/js-logger';

/**
 * Creates a mock Logger instance for testing.
 * All logger methods are vi.fn() spies that can be asserted against.
 */
export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  } as unknown as Logger;
}
