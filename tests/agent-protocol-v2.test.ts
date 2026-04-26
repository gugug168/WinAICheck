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

function setupWorkerConfig(root: string, overrides: Record<string, any> = {}) {
  const p = _testHelpers.paths({ baseDir: root });
  _testHelpers.writeJson(p.config, {
    clientId: 'client-test',
    deviceId: 'device-test',
    shareData: true,
    autoSync: true,
    paused: false,
    authToken: 'ak_test_123',
    workerEnabled: true,
    ...overrides,
  });
  return p;
}

// Helper to create mock fetch responses compatible with both requestJson (text()) and direct .json()
function mockResponse(data: any, status = 200) {
  const body = JSON.stringify(data);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => data,
    text: async () => body,
  };
}

function createSpawnStub() {
  const calls: Array<{ command: string; args: string[]; options: Record<string, any> }> = [];
  return {
    calls,
    spawnImpl(command: string, args: string[], options: Record<string, any>) {
      calls.push({ command, args, options });
      return {
        pid: 43210 + calls.length,
        unref() {},
      };
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
        return mockResponse({
          recommended_bounties: [{ id: 'bounty_1' }, { id: 'bounty_2' }],
        });
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
        return mockResponse({
          bounty_id: 'bounty_1',
          lease_id: 'lease_1',
          claimed_until: '2026-04-24T12:00:00Z',
          slot_limit: 2,
        });
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
        return mockResponse({ ok: true });
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

describe('worker-on (TASK-090)', () => {
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workerEnabled defaults to true in config', () => {
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

    const config = _testHelpers.loadConfig({ baseDir: root });
    expect(config.workerEnabled).toBe(true);
  });

  test('worker status shows config and state', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const io = createIo();
    const code = await agentMain(['worker', 'status'], { baseDir: root }, io.io);

    expect(code).toBe(0);
    expect(io.output).toContain('"workerEnabled": true');
    expect(io.output).toContain('"status": "stopped"');
  });

  test('worker daemon performs heartbeat and processes recommended_bounties', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const requests: { url: string; body?: string }[] = [];
    let fetchCount = 0;

    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        requests.push({ url, body: init?.body ? String(init.body) : undefined });
        fetchCount++;

        // After heartbeat + auto-solve + claim-and-submit (3 calls), disable to exit
        if (fetchCount >= 3) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }

        if (url.includes('/heartbeat')) {
          return mockResponse({ recommended_bounties: [{ id: 'bounty_w1', recommended_env_id: 'win-py311' }] });
        }
        if (url.includes('/auto-solve')) {
          return mockResponse({ matched: true, answer: 'KB solution text', confidence: 0.9 });
        }
        if (url.includes('/claim-and-submit')) {
          return mockResponse({ id: 'answer_1', bounty_id: 'bounty_w1' });
        }
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests[0].url).toContain('/heartbeat');
    expect(requests[0].body).toContain('"worker_status":"active"');
    expect(requests[1].url).toContain('/auto-solve');
    expect(requests[2].url).toContain('/claim-and-submit');
    expect(requests[2].body).toContain('"source":"kb_auto"');
    expect(requests[2].body).toContain('"env_id":"win-py311"');

    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalCycles).toBeGreaterThanOrEqual(1);
    expect(wState.totalSolved).toBeGreaterThanOrEqual(1);
  });

  test('pause stops worker from processing bounties', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    let heartbeatDone = false;

    const io = createIo();
    const daemonPromise = agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        if (url.includes('/heartbeat')) {
          // After first heartbeat, set paused; then disable after a short delay
          if (!heartbeatDone) {
            heartbeatDone = true;
            // Schedule disable after pause-check interval to let pause be detected
            setTimeout(() => {
              const config = _testHelpers.loadConfig({ baseDir: root });
              config.workerEnabled = false;
              _testHelpers.saveConfig(config, { baseDir: root });
            }, 50);
          }
          return mockResponse({ recommended_bounties: [] });
        }
        return mockResponse({});
      },
    }, io.io);

    // Set paused immediately
    const config = _testHelpers.loadConfig({ baseDir: root });
    config.paused = true;
    _testHelpers.saveConfig(config, { baseDir: root });

    await daemonPromise;

    expect(io.output).toContain('已暂停');
  });

  test('disable sets workerEnabled to false and persists', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const io = createIo();
    const code = await agentMain(['disable'], { baseDir: root }, io.io);

    expect(code).toBe(0);
    expect(io.output).toContain('已彻底禁用');

    const config = _testHelpers.loadConfig({ baseDir: root });
    expect(config.workerEnabled).toBe(false);
    expect(config.paused).toBe(false);
  });

  test('worker-enable re-enables worker without changing upload pause state', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root, { workerEnabled: false, paused: true });

    const io = createIo();
    const code = await agentMain(['worker-enable'], { baseDir: root }, io.io);

    expect(code).toBe(0);
    expect(io.output).toContain('已重新启用');

    const config = _testHelpers.loadConfig({ baseDir: root });
    expect(config.workerEnabled).toBe(true);
    expect(config.paused).toBe(true);
  });

  test('worker daemon never executes local fix commands', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    let fetchCount = 0;
    const bodies: string[] = [];

    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        fetchCount++;
        if (init?.body) bodies.push(String(init.body));
        if (fetchCount >= 3) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) {
          return mockResponse({ recommended_bounties: [{ id: 'bounty_nolocal' }] });
        }
        if (url.includes('/auto-solve')) {
          return mockResponse({ matched: true, answer: 'safe KB answer', confidence: 0.9 });
        }
        if (url.includes('/claim-and-submit')) {
          return mockResponse({ id: 'ans_1' });
        }
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    // The claim-and-submit request body must contain source: kb_auto
    const submitBody = bodies.find(b => b.includes('kb_auto'));
    expect(submitBody).toBeDefined();
    expect(submitBody).toContain('"source":"kb_auto"');
    // Never includes local command execution markers
    expect(submitBody).not.toContain('exec(');
    expect(submitBody).not.toContain('spawn(');
  });

  test('worker daemon skips unmatched bounties', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    let fetchCount = 0;

    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        fetchCount++;
        if (fetchCount >= 5) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) {
          return mockResponse({ recommended_bounties: [{ id: 'b1' }, { id: 'b2' }] });
        }
        if (url.includes('/auto-solve')) {
          return mockResponse({ matched: false });
        }
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalSolved).toBe(0);
    expect(wState.totalSkipped).toBeGreaterThanOrEqual(2);
  });

  test('enable waits for binding before auto-starting worker', async () => {
    const root = createTempRoot();
    roots.push(root);
    const spawn = createSpawnStub();

    const io = createIo();
    const code = await agentMain(['enable', '--target', 'claude-code'], {
      baseDir: root,
      homeDir: root,
      spawnImpl: spawn.spawnImpl,
    }, io.io);

    expect(code).toBe(0);
    expect(io.output).toContain('等待绑定完成后自动启动');
    expect(spawn.calls).toHaveLength(0);
  });

  test('bind auto-starts worker after token is granted', async () => {
    const root = createTempRoot();
    roots.push(root);
    const spawn = createSpawnStub();
    setupWorkerConfig(root, { authToken: undefined });

    const io = createIo();
    const code = await agentMain(['bind', '--code', '123456'], {
      baseDir: root,
      homeDir: root,
      spawnImpl: spawn.spawnImpl,
      fetchImpl: async () => mockResponse({ api_key: 'ak_test_123' }),
    }, io.io);

    expect(code).toBe(0);
    expect(io.output).toContain('绑定成功');
    expect(io.output).toContain('Worker 互助循环: 已启动');
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]?.args.join(' ')).toContain('worker daemon');
  });
});
