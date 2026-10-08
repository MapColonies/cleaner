import { FailureReason } from './constants';

const REASON_PATTERNS: [FailureReason, string[]][] = [
  [FailureReason.THROTTLED, ['slowdown', 'throttl', 'toomanyrequests', 'requestlimitexceeded']],
  [FailureReason.TIMEOUT, ['timeout', 'timedout']],
  [FailureReason.CONNECTION, ['econnrefused', 'econnreset', 'epipe', 'enotfound', 'ehostunreach', 'enetunreach', 'eaiagain', 'connection']],
  [
    FailureReason.ACCESS_DENIED,
    ['eacces', 'eperm', 'accessdenied', 'forbidden', 'invalidaccesskeyid', 'signaturedoesnotmatch', 'noauth', 'noperm', 'wrongpass'],
  ],
  [FailureReason.NOT_FOUND, ['enoent', 'nosuch', 'notfound']],
];

/**
 * Maps a raw failure reason (errno code, S3 error code or error message) to a bounded
 * label value, so failure metrics keep a fixed cardinality. The raw reason stays in logs.
 */
export function toFailureReason(rawReason: string): FailureReason {
  const normalized = rawReason.toLowerCase().replace(/[^a-z0-9]/g, '');
  const match = REASON_PATTERNS.find(([, patterns]) => patterns.some((pattern) => normalized.includes(pattern)));
  return match?.[0] ?? FailureReason.OTHER;
}
