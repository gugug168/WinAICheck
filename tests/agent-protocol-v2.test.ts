import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { main as agentMain, _testHelpers } from '../bin/agent-lite.js';

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), 'winaicheck-agent-v2-'));
}

function createIo() {
  let output = '';
  return {
    io: {
      stdout: { write: (text) => { output += text; return true; } },
      stderr: { write: (text) => { output += text; return true; } },
    },
    get output() {
      return output;
    },
  };
}

describe('agent protocol v2', () => {
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('bounty-recommended reads v2 recommendations from heartbeat', async () => {
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

    let request = null;
    const io = createIo();
    const code = await agentMain(['bounty-recommended', '--limit', '1'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        request = { url, body: init?.body ? String(init.body) : undefined };
        return {
          status: 200,
          ok: true,
          json: async () => ({
            recommended_bounties: [{ id: 'bounty_1' }, { id: 'bounty_2' }],
          }),
          text: async () => JSON.stringify({
            recommended_bounties: [{ id: 'bounty_1' }, { id: 'bounty_2' }],
          }),
        };
      },
    }, io.io);

    expect(code).toBe(0);
    expect(request.url).toBe('https://aicoevo.net/api/v2/agent/heartbeat');
    expect(request.body).toContain('"status":"idle"');
    expect(io.output).toContain('"id": "bounty_1"');
    expect(io.output).not.toContain('"id": "bounty_2"');
  });

  test('bounty-claim heartbeats first, then uses the v2 claim route', async () => {
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

    const requests = [];
    const io = createIo();
    const code = await agentMain(['bounty-claim', 'bounty_1'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        requests.push({ url, body: init?.body ? String(init.body) : undefined });
        return {
          status: 200,
          ok: true,
          json: async () => ({
            bounty_id: 'bounty_1',
            lease_id: 'lease_1',
            claimed_until: '2026-04-24T12:00:00Z',
            slot_limit: 2,
          }),
          text: async () => JSON.stringify({
            bounty_id: 'bounty_1',
            lease_id: 'lease_1',
            claimed_until: '2026-04-24T12:00:00Z',
            slot_limit: 2,
          }),
        };
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests.map(item => item.url)).toEqual([
      'https://aicoevo.net/api/v2/agent/heartbeat',
      'https://aicoevo.net/api/v2/agent/bounties/bounty_1/claim',
    ]);
    expect(requests[0].body).toContain('"status":"idle"');
    expect(requests[1].body).toBe('{}');
    expect(io.output).toContain('lease_1');
  });

  test('review-submit uses the v2 reviewer endpoint', async () => {
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

    let request = null;
    const code = await agentMain(['review-submit', 'lease_9', '--result', 'success'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        request = { url, body: init?.body ? String(init.body) : undefined };
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      },
    }, createIo().io);

    expect(code).toBe(0);
    expect(request.url).toBe('https://aicoevo.net/api/v2/agent/reviews/lease_9/submit');
    expect(request.body).toContain('"result":"success"');
    expect(request.body).toContain('"execution_mode":"agent"');
  });

  // ── TASK-100: Owner reproduction loop ──

  test('owner-check lists pending owner verifications from status', async () => {
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

    let request = null;
    const io = createIo();
    const code = await agentMain(['owner-check'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        request = { url, body: init?.body ? String(init.body) : undefined };
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({
            owner_metrics: { queued_problems: 0, solutions_pending_owner: 1 },
            worker_metrics: {},
            pending_owner_verifications: [{
              bounty_id: 'b_001',
              answer_id: 'a_001',
              title: 'pip install fails',
              solution_summary: 'Run pip install --upgrade pip',
              submitted_at: '2026-04-26T00:00:00Z',
              deadline_at: '2026-04-28T00:00:00Z',
            }],
            timestamp: '2026-04-26T00:00:00Z',
          }),
        };
      },
    }, io.io);

    expect(code).toBe(0);
    expect(request.url).toBe('https://aicoevo.net/api/v2/agent/status');
    expect(io.output).toContain('b_001');
    expect(io.output).toContain('a_001');
    expect(io.output).toContain('pip install fails');
    expect(io.output).toContain('owner-verify');
  });

  test('owner-check shows empty message when no pending', async () => {
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

    const io = createIo();
    const code = await agentMain(['owner-check'], {
      baseDir: root,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({
          owner_metrics: {},
          worker_metrics: {},
          pending_owner_verifications: [],
          timestamp: '2026-04-26T00:00:00Z',
        }),
      }),
    }, io.io);

    expect(code).toBe(0);
    expect(io.output).toContain('没有待复现确认');
  });

  test('owner-verify submits verification result to endpoint', async () => {
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

    let request = null;
    const io = createIo();
    const code = await agentMain(['owner-verify', 'b_001', '--answer', 'a_001', '--result', 'success', '--yes'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        request = { url, body: init?.body ? String(init.body) : undefined };
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({
            bounty_id: 'b_001',
            answer_id: 'a_001',
            owner_verification: 'success',
            owner_score: 60,
            community_score: 0,
            total_score: 60,
            threshold: 70,
            review_status: 'pending_review',
          }),
        };
      },
    }, io.io);

    expect(code).toBe(0);
    expect(request.url).toBe('https://aicoevo.net/api/v2/agent/bounties/b_001/owner-verify');
    const body = JSON.parse(request.body);
    expect(body.answer_id).toBe('a_001');
    expect(body.result).toBe('success');
    expect(io.output).toContain('60');
    expect(io.output).toContain('pending_review');
  });

  test('owner-verify rejects missing required args', async () => {
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

    const io = createIo();
    const code = await agentMain(['owner-verify'], {
      baseDir: root,
      fetchImpl: async () => ({ status: 200, text: async () => '{}' }),
    }, io.io);

    expect(code).toBe(1);
    expect(io.output).toContain('用法');
  });
});
