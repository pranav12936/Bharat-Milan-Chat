import { describe, expect, it } from 'vitest';
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = 'postgresql://unused'; process.env.SESSION_SECRET = 'a-very-long-test-secret-that-is-not-for-production';
const { validateMedia } = await import('./storage.js');
describe('media allowlist', () => { it('accepts JPEG within its limit', () => expect(validateMedia('image/jpeg', 10)).toBe('image')); it('rejects text payloads', () => expect(() => validateMedia('text/plain', 10)).toThrow()); it('rejects oversized video', () => expect(() => validateMedia('video/mp4', 200_000_000)).toThrow()); });
