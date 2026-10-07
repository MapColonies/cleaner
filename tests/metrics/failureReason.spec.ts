import { describe, it, expect } from 'vitest';
import { FailureReason, toFailureReason } from '@src/cleaner/metrics';

describe('toFailureReason', () => {
  it.each([
    ['ENOENT', FailureReason.NOT_FOUND],
    ['NoSuchKey', FailureReason.NOT_FOUND],
    ['NoSuchBucket', FailureReason.NOT_FOUND],
    ['EACCES', FailureReason.ACCESS_DENIED],
    ['EPERM', FailureReason.ACCESS_DENIED],
    ['AccessDenied', FailureReason.ACCESS_DENIED],
    ['Access Denied', FailureReason.ACCESS_DENIED],
    ['NOAUTH Authentication required.', FailureReason.ACCESS_DENIED],
    ['ETIMEDOUT', FailureReason.TIMEOUT],
    ['RequestTimeout', FailureReason.TIMEOUT],
    ['ECONNREFUSED', FailureReason.CONNECTION],
    ['ECONNRESET', FailureReason.CONNECTION],
    ['ENOTFOUND', FailureReason.CONNECTION],
    ['Connection is closed.', FailureReason.CONNECTION],
    ['SlowDown', FailureReason.THROTTLED],
    ['ThrottlingException', FailureReason.THROTTLED],
  ])('maps %s to %s', (rawReason, expected) => {
    expect(toFailureReason(rawReason)).toBe(expected);
  });

  it.each(['Unknown', 'non-serializable thrown value', '', 'EISDIR'])('maps unrecognized reason %j to other', (rawReason) => {
    expect(toFailureReason(rawReason)).toBe(FailureReason.OTHER);
  });
});
