import { describe, expect, test } from 'bun:test';
import { stashData, type UploadPayload } from '../src/privacy/uploader';

describe('scan intake upload contract', () => {
  test('uploads to problem-brief scan-intake endpoint', async () => {
    const payload: UploadPayload = {
      timestamp: new Date('2026-04-22T00:00:00.000Z').toISOString(),
      score: 72,
      results: [
        {
          id: 'cuda-version',
          name: 'CUDA',
          category: 'gpu',
          status: 'warn',
          message: 'Toolkit missing',
          error_type: 'missing',
        },
      ],
      systemInfo: {
        os: 'Windows 11',
        cpu: 'AMD Ryzen',
        ramGB: 32,
        gpu: 'RTX 4060',
        diskFreeGB: 128,
      },
    };

    const calls: Array<{ input: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ input: String(input), body: typeof init?.body === 'string' ? init.body : undefined });
      return {
        ok: true,
        json: async () => ({
          token: 'abc123',
          claim_url: 'https://aicoevo.net/claim?t=abc123',
          ttl_seconds: 900,
          problem_brief_id: 'pb1',
          evidence_pack_id: 'ep1',
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const result = await stashData(payload, 'https://aicoevo.net/api/v1');
      expect(result.problem_brief_id).toBe('pb1');
      expect(calls[0]?.input).toBe('https://aicoevo.net/api/v1/problem-briefs/scan-intake');
      expect(calls[0]?.body).toContain('"data"');
      expect(calls[0]?.body).toContain('"fingerprint"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
