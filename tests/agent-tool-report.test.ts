import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { main as agentMain, _testHelpers } from '../bin/agent-lite.js';

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'winaicheck-tool-report-'));
}

describe('agent-tool-report', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('tool auto report network failure queues locally with redaction', async () => {
    const root = createTempRoot();
    roots.push(root);

    const result = await _testHelpers.reportToolAutoEvent({
      step: 'bind',
      status: 'error',
      eventType: 'step_failed',
      failedItems: ['bind-request'],
      message: 'bind failed at C:\\Users\\Alice\\repo with OPENAI_API_KEY=sk-secret-12345678',
      content: 'bind request failed',
    }, {
      baseDir: root,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    const queuePath = _testHelpers.paths({ baseDir: root }).toolFeedbackQueue;
    const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
    expect(result.status).toBe(0);
    expect(queue).toHaveLength(1);
    expect(queue[0].state).toBe('queued');
    expect(queue[0].payload.env_summary.message).toContain('C:\\Users\\<USER>\\repo');
    expect(queue[0].payload.env_summary.message).not.toContain('sk-secret');
  });

  test('queued tool auto report flushes later and marks flushed', async () => {
    const root = createTempRoot();
    roots.push(root);

    await _testHelpers.reportToolAutoEvent({
      step: 'sync',
      status: 'error',
      eventType: 'step_failed',
      failedItems: ['agent-events-batch'],
      message: 'service unavailable',
      content: 'sync failed',
    }, {
      baseDir: root,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    const queuePath = _testHelpers.paths({ baseDir: root }).toolFeedbackQueue;
    const queued = JSON.parse(readFileSync(queuePath, 'utf8'));
    queued[0].nextAttemptAt = '2000-01-01T00:00:00.000Z';
    writeFileSync(queuePath, JSON.stringify(queued, null, 2) + '\n', 'utf8');

    const flush = await _testHelpers.flushToolAutoReports({
      baseDir: root,
      fetchImpl: async (url: string, init: RequestInit) => {
        if (url.endsWith('/api/v1/feedback')) {
          const body = JSON.parse(String(init.body || '{}'));
          expect(body.env_summary.step).toBe('sync');
          return {
            status: 200,
            text: async () => JSON.stringify({ status: 'received' }),
          } as any;
        }
        throw new Error(`unexpected url ${url}`);
      },
    });

    const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
    expect(flush.flushed).toBe(1);
    expect(queue[0].state).toBe('flushed');
  });

  test('tool auto report marks non-retryable 4xx as failed', async () => {
    const root = createTempRoot();
    roots.push(root);

    const result = await _testHelpers.reportToolAutoEvent({
      step: 'bind',
      status: 'error',
      eventType: 'step_failed',
      failedItems: ['bind-request'],
      message: 'bad payload',
      content: 'bind request failed',
    }, {
      baseDir: root,
      fetchImpl: async () => ({
        status: 400,
        text: async () => JSON.stringify({ detail: 'bad request' }),
      } as any),
    });

    const queuePath = _testHelpers.paths({ baseDir: root }).toolFeedbackQueue;
    const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
    expect(result.status).toBe(400);
    expect(queue[0].state).toBe('failed');
    expect(queue[0].lastStatus).toBe(400);
  });

  test('enable worker start failure auto-reports enable failure', async () => {
    const root = createTempRoot();
    roots.push(root);
    const p = _testHelpers.paths({ baseDir: root });
    _testHelpers.writeJson(p.config, {
      clientId: 'client-test',
      deviceId: 'device-test',
      shareData: true,
      autoSync: true,
      paused: false,
      authToken: 'ak_test_123',
      workerEnabled: true,
    });

    const requests: Array<{ url: string; body: any }> = [];
    const code = await agentMain(['enable', '--target', 'claude-code'], {
      baseDir: root,
      workerStartTimeoutMs: 5,
      workerStartPollMs: 1,
      spawnImpl: () => ({ pid: null, unref() {} }) as any,
      fetchImpl: async (url: string, init: RequestInit) => {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        requests.push({ url, body });
        if (url.endsWith('/api/v1/feedback')) {
          expect(body.env_summary.step).toBe('enable');
          expect(body.env_summary.event_type).toBe('step_failed');
          return {
            status: 200,
            text: async () => JSON.stringify({ status: 'received' }),
          } as any;
        }
        throw new Error(`unexpected url ${url}`);
      },
    }, {
      stdout: { write: () => true },
      stderr: { write: () => true },
    } as any);

    expect(code).toBe(0);
    expect(requests.some(req => req.url.endsWith('/api/v1/feedback'))).toBe(true);
  });

  test('bounty-claim failure auto-reports claim failure', async () => {
    const root = createTempRoot();
    roots.push(root);
    const p = _testHelpers.paths({ baseDir: root });
    _testHelpers.writeJson(p.config, {
      clientId: 'client-test',
      deviceId: 'device-test',
      shareData: true,
      autoSync: true,
      paused: false,
      authToken: 'ak_test_123',
    });

    const requests: Array<{ url: string; body: any }> = [];
    const code = await agentMain(['bounty-claim', 'bounty_123'], {
      baseDir: root,
      fetchImpl: async (url: string, init: RequestInit) => {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        requests.push({ url, body });
        if (url.includes('/api/v2/agent/heartbeat')) {
          return {
            status: 200,
            json: async () => ({ ok: true }),
            text: async () => JSON.stringify({ ok: true }),
          } as any;
        }
        if (url.includes('/api/v2/agent/bounties/bounty_123/claim')) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ detail: 'lease conflict' }),
            text: async () => JSON.stringify({ detail: 'lease conflict' }),
          } as any;
        }
        if (url.endsWith('/api/v1/feedback')) {
          expect(body.env_summary.step).toBe('claim');
          expect(body.env_summary.failed_items).toEqual(['bounty-claim']);
          expect(body.env_summary.claim_id).toBe('bounty_123');
          expect(body.env_summary.message).toContain('lease conflict');
          return {
            status: 200,
            text: async () => JSON.stringify({ status: 'received' }),
          } as any;
        }
        throw new Error(`unexpected url ${url}`);
      },
    }, {
      stdout: { write: () => true },
      stderr: { write: () => true },
    } as any);

    expect(code).toBe(1);
    expect(requests.some(req => req.url.endsWith('/api/v1/feedback'))).toBe(true);
  });
});
