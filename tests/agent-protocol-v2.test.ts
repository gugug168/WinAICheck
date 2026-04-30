import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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

function createSpawnStub(onSpawn?: (call: { command: string; args: string[]; options: Record<string, any>; pid: number }) => void) {
  const calls: Array<{ command: string; args: string[]; options: Record<string, any> }> = [];
  return {
    calls,
    spawnImpl(command: string, args: string[], options: Record<string, any>) {
      const pid = 43210 + calls.length + 1;
      const call = { command, args, options, pid };
      calls.push({ command, args, options });
      onSpawn?.(call);
      return {
        pid,
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

  test('bounty-submit forwards validation contract fields when provided', async () => {
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
    const code = await agentMain([
      'bounty-submit',
      'bounty_1',
      '--content',
      'Use pytest to verify',
      '--cmd',
      'pytest -q',
      '--validation-cmd',
      'pytest -q',
      '--expected-output',
      '3 passed',
      '--summary',
      'Run tests after fix',
    ], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        request = { url, body: init?.body ? String(init.body) : undefined };
        return mockResponse({ id: 'ans_submit_1' });
      },
    }, io.io);

    expect(code).toBe(0);
    expect(request.url).toBe('https://aicoevo.net/api/v2/agent/bounties/bounty_1/submit');
    const body = JSON.parse(request.body || '{}');
    expect(body.commands_run).toEqual(['pytest -q']);
    expect(body.proof_payload.validation_cmd).toBe('pytest -q');
    expect(body.proof_payload.expected_output).toBe('3 passed');
    expect(body.proof_payload.summary).toBe('Run tests after fix');
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
              execution_decision: {
                decision: 'ask_user_run',
                phase: 'owner_verification',
                current_profile_is_target: true,
                target_route: {
                  profile_id: 'prof_001',
                  device_id: 'device_001',
                  agent_type: 'claude-code',
                },
              },
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
    expect(io.output).toContain('执行决策: ask_user_run');
    expect(io.output).toContain('目标机器: profile=prof_001 / device=device_001 / agent=claude-code');
    expect(io.output).toContain('自动验证: blocked');
    expect(io.output).toContain('阻塞原因: missing_validation_command');
    const guidePath = join(root, 'owner-verify', 'b_001__a_001.md');
    const snapshotPath = join(root, 'owner-verify', 'b_001__a_001.json');
    expect(existsSync(guidePath)).toBe(true);
    expect(existsSync(snapshotPath)).toBe(true);
    expect(readFileSync(guidePath, 'utf8')).toContain('AICOEVO 发起者复现指南');
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

  test('review-list keeps the matched project directory instead of walking to a parent folder', async () => {
    const root = createTempRoot();
    roots.push(root);
    const p = _testHelpers.paths({ baseDir: root });
    const projectDir = join(root, 'repo');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'test_review_ready.py'), '# smoke\n', 'utf8');
    _testHelpers.writeJson(p.config, {
      clientId: 'client-test',
      deviceId: 'device-test',
      shareData: true,
      autoSync: true,
      paused: false,
      authToken: 'ak_test_123',
    });
    mkdirSync(join(root, 'outbox'), { recursive: true });
    writeFileSync(
      p.outbox,
      `${JSON.stringify({
        fingerprint: 'fp_review_ready_1',
        eventType: 'post_tool_error',
        agent: 'claude-code',
        deviceId: 'device-test',
        occurredAt: '2026-04-30T00:00:00Z',
        toolContext: {
          command: 'pytest -q',
          filePath: join(projectDir, 'test_review_ready.py'),
          fileName: 'test_review_ready.py',
          cwd: projectDir,
        },
        localContext: {
          cwdHash: 'cwdhash-review-ready-1',
        },
      })}\n`,
      'utf8',
    );

    const io = createIo();
    const code = await agentMain(['review-list'], {
      baseDir: root,
      fetchImpl: async () => mockResponse({
        items: [
          {
            assignment_id: 'lease_1',
            answer: { id: 'a_ready_1', content: 'Fix review ready issue' },
            submission_run: {
              proof_payload: {
                validation_cmd: 'pytest -q',
                expected_output: '3 passed',
                summary: 'Dependency mismatch resolved',
              },
              commands_run: ['pytest -q'],
            },
            project_hint: {
              fingerprint: 'fp_review_ready_1',
              event_type: 'post_tool_error',
              cwd_hash: 'cwdhash-review-ready-1',
              origin_device_id: 'device-test',
              origin_agent_type: 'claude-code',
              tool_context: {
                command: 'pytest -q',
                fileName: 'test_review_ready.py',
              },
            },
          },
        ],
        total: 1,
      }),
    }, io.io);

    expect(code).toBe(0);
    const data = JSON.parse(io.output);
    expect(data.items[0]?.local_automation_readiness.status).toBe('ready');
    expect(data.items[0]?.local_automation_readiness.suggested_project_dir).toBe(projectDir);
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
    expect(body.proof_payload.summary).toContain('b_001/a_001');
    expect(body.proof_payload.before_context.item.answer_id).toBe('a_001');
    expect(body.proof_payload.after_context.result).toBe('success');
    expect(body.artifacts.owner_reproduction_guide_path).toContain('b_001__a_001.md');
    expect(body.artifacts.owner_reproduction_snapshot_path).toContain('b_001__a_001.json');
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
    const code = await agentMain(['worker', 'status'], { baseDir: root, homeDir: root }, io.io);

    expect(code).toBe(0);
    expect(io.output).toContain('"workerEnabled": true');
    expect(io.output).toContain('"status": "stopped"');
    expect(io.output).toContain('"api_key_bound": true');
    expect(io.output).toContain('"hook_not_configured"');
  });

  test('draft-organizer run-once requests scheduled work, fetches only its own batch, and submits one payload', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root, {
      authToken: 'ak_test_profile',
      draftOrganizerEnabled: true,
      draftOrganizerMode: 'apply',
      draftOrganizerTriggerMode: 'hybrid',
      draftOrganizerScheduleDays: 7,
      profileId: 'prof_win',
    });

    const requests: Array<{ url: string; body?: string }> = [];
    const io = createIo();
    const code = await agentMain(['draft-organizer', 'run-once'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
        if (String(url).endsWith('/api/v2/agent/draft-reconcile/request-scheduled')) {
          return mockResponse({ ok: true, queued_batch_count: 1 });
        }
        if (String(url).endsWith('/api/v2/agent/status')) {
          return mockResponse({
            owner_metrics: {},
            worker_metrics: {},
            pending_owner_verifications: [],
            pending_draft_reconcile_batches: [
              {
                id: 'batch_win_1',
                title: 'Windows Claude draft reconcile',
                profile_id: 'prof_win',
                profile_label: 'Windows Claude',
                draft_count: 2,
                requested_at: '2026-04-29T08:00:00Z',
                trigger: 'manual',
                status: 'queued',
              },
            ],
            timestamp: '2026-04-29T08:00:00Z',
          });
        }
        if (String(url).endsWith('/api/v2/agent/draft-reconcile-batches/batch_win_1')) {
          return mockResponse({
            id: 'batch_win_1',
            profile_id: 'prof_win',
            drafts: [
              {
                id: 'draft_1',
                title: 'TypeError in build',
                source_data: {
                  origin_profile_id: 'prof_win',
                  origin_device_id: 'device-test',
                  origin_agent_type: 'claude-code',
                  event_ids: ['evt_1'],
                },
              },
            ],
          });
        }
        if (String(url).endsWith('/api/v2/agent/draft-reconcile-batches/batch_win_1/submit')) {
          return mockResponse({ ok: true, accepted: 1 });
        }
        throw new Error(`unexpected request ${String(url)}`);
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests.map((item) => item.url)).toContain('https://aicoevo.net/api/v2/agent/draft-reconcile/request-scheduled');
    expect(requests.map((item) => item.url)).toContain('https://aicoevo.net/api/v2/agent/status');
    expect(requests.map((item) => item.url)).toContain('https://aicoevo.net/api/v2/agent/draft-reconcile-batches/batch_win_1');
    expect(requests.map((item) => item.url)).toContain('https://aicoevo.net/api/v2/agent/draft-reconcile-batches/batch_win_1/submit');
    expect(requests.find((item) => item.url.endsWith('/submit'))?.body).toContain('"draft_id":"draft_1"');
  });

  test('worker daemon triggers draft organizer without crossing profile boundaries', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root, {
      authToken: 'ak_test_profile',
      draftOrganizerEnabled: true,
      draftOrganizerMode: 'apply',
      draftOrganizerTriggerMode: 'manual_only',
      profileId: 'prof_win',
    });

    const requests: string[] = [];
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '1', '--run-once'], {
      baseDir: root,
      fetchImpl: async (url) => {
        requests.push(String(url));
        if (String(url).endsWith('/api/v2/agent/status')) {
          return mockResponse({
            owner_metrics: {},
            worker_metrics: {
              recommended_tasks: 0,
              active_solver_leases: 0,
              pending_review_leases: 0,
              worker_xp: 0,
            },
            pending_owner_verifications: [],
            pending_draft_reconcile_batches: [],
            timestamp: '2026-04-29T08:00:00Z',
          });
        }
        return mockResponse({ recommended_bounties: [] });
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests.filter((url) => url.endsWith('/api/v2/agent/status')).length).toBeGreaterThan(0);
  });

  test('draft-organizer scheduled_only ignores manual batches and consumes scheduled batches', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root, {
      authToken: 'ak_test_profile',
      draftOrganizerEnabled: true,
      draftOrganizerMode: 'apply',
      draftOrganizerTriggerMode: 'scheduled_only',
      draftOrganizerScheduleDays: 7,
      profileId: 'prof_win',
    });

    const requests: Array<{ url: string; body?: string }> = [];
    const io = createIo();
    const code = await agentMain(['draft-organizer', 'run-once'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
        if (String(url).endsWith('/api/v2/agent/draft-reconcile/request-scheduled')) {
          return mockResponse({ ok: true, queued_batch_count: 1 });
        }
        if (String(url).endsWith('/api/v2/agent/status')) {
          return mockResponse({
            owner_metrics: {},
            worker_metrics: {},
            pending_owner_verifications: [],
            pending_draft_reconcile_batches: [
              {
                id: 'batch_manual_1',
                title: 'Windows manual draft reconcile',
                profile_id: 'prof_win',
                profile_label: 'Windows Claude',
                draft_count: 1,
                requested_at: '2026-04-29T08:00:00Z',
                trigger: 'manual',
                status: 'queued',
              },
              {
                id: 'batch_scheduled_1',
                title: 'Windows scheduled draft reconcile',
                profile_id: 'prof_win',
                profile_label: 'Windows Claude',
                draft_count: 1,
                requested_at: '2026-04-29T08:10:00Z',
                trigger: 'scheduled',
                status: 'queued',
              },
            ],
            timestamp: '2026-04-29T08:00:00Z',
          });
        }
        if (String(url).endsWith('/api/v2/agent/draft-reconcile-batches/batch_scheduled_1')) {
          return mockResponse({
            id: 'batch_scheduled_1',
            profile_id: 'prof_win',
            drafts: [
              {
                id: 'draft_scheduled_1',
                title: 'Scheduled draft',
                source_data: {
                  origin_profile_id: 'prof_win',
                  origin_device_id: 'device-test',
                  origin_agent_type: 'claude-code',
                  event_ids: ['evt_scheduled_1'],
                },
              },
            ],
          });
        }
        if (String(url).endsWith('/api/v2/agent/draft-reconcile-batches/batch_scheduled_1/submit')) {
          return mockResponse({ ok: true, accepted: 1 });
        }
        throw new Error(`unexpected request ${String(url)}`);
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests.map((item) => item.url)).toContain('https://aicoevo.net/api/v2/agent/draft-reconcile/request-scheduled');
    expect(requests.map((item) => item.url)).toContain('https://aicoevo.net/api/v2/agent/draft-reconcile-batches/batch_scheduled_1');
    expect(requests.map((item) => item.url)).toContain('https://aicoevo.net/api/v2/agent/draft-reconcile-batches/batch_scheduled_1/submit');
    expect(requests.some((item) => item.url.includes('batch_manual_1'))).toBe(false);
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

  test('worker daemon skips strict submission bounties before auto-solve', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const requests = [];
    let fetchCount = 0;

    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      fetchImpl: async (url, init) => {
        requests.push({ url, body: init?.body ? String(init.body) : undefined });
        fetchCount++;
        if (fetchCount >= 3) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) {
          return mockResponse({
            recommended_bounties: [
              {
                id: 'bounty_strict_1',
                submission_auto_contract_required: true,
                submission_automation_policy: 'strict',
              },
            ],
          });
        }
        if (url.includes('/reviews/recommended')) return mockResponse({ items: [] });
        if (url.includes('/status')) return mockResponse({ pending_owner_verifications: [] });
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests[0].url).toContain('/heartbeat');
    expect(requests.some(req => req.url.includes('/auto-solve'))).toBe(false);
    expect(requests.some(req => req.url.includes('/claim-and-submit'))).toBe(false);
    expect(io.output).toContain('平台要求严格自动化契约');
    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalSkipped).toBeGreaterThanOrEqual(1);
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

  test('worker daemon auto-submits owner verification with a safe validation command', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);
    const projectRoot = join(root, 'demo-owner-project');
    const projectFile = join(projectRoot, 'tests', 'test_owner_auto.py');
    const p = _testHelpers.paths({ baseDir: root });
    _testHelpers.writeJson(p.config, {
      ..._testHelpers.readJson(p.config, {}),
      authToken: 'ak_test_123',
    });
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(join(projectRoot, 'pyproject.toml'), '[project]\nname="demo-owner"\n', 'utf8');
    writeFileSync(projectFile, 'print("ok")\n', 'utf8');
    mkdirSync(join(root, 'outbox'), { recursive: true });
    writeFileSync(p.outbox, `${JSON.stringify({
      eventId: 'evt_owner_auto_1',
      deviceId: 'device-test_cc',
      agent: 'claude-code',
      fingerprint: 'fp_owner_auto_1',
      eventType: 'post_tool_error',
      occurredAt: '2026-04-30T00:00:00Z',
      sanitizedMessage: 'pytest failed in test_owner_auto.py',
      toolContext: { filePath: projectFile, command: 'pytest -q' },
    })}\n`, 'utf8');

    const requests: { url: string; body?: string }[] = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command, options) => {
        expect(command).toBe('pytest -q');
        expect(options?.cwd).toBe(projectRoot);
        return { exitCode: 0, stdout: '3 passed', stderr: '' };
      },
      fetchImpl: async (url, init) => {
        requests.push({ url, body: init?.body ? String(init.body) : undefined });
        fetchCount++;
        if (fetchCount >= 3) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/status')) {
          return mockResponse({
            pending_owner_verifications: [{
              bounty_id: 'b_owner_1',
              answer_id: 'a_owner_1',
              title: 'pytest owner auto',
              solution_summary: 'Run tests again',
              submitted_at: '2026-04-30T00:00:00Z',
              deadline_at: '2026-05-02T00:00:00Z',
              validation_cmd: 'pytest -q',
              expected_output: '3 passed',
              commands_run: ['npm install', 'pytest -q'],
              project_hint: {
                fingerprint: 'fp_owner_auto_1',
                event_type: 'post_tool_error',
                origin_device_id: 'device-test',
                origin_agent_type: 'claude-code',
                tool_context: { fileName: 'test_owner_auto.py', command: 'pytest -q' },
              },
              automation_contract: { mode: 'auto', auto_run_allowed: true },
              automation_readiness: { status: 'ready', selected_command: 'pytest -q' },
            }],
          });
        }
        if (url.includes('/owner-verify')) return mockResponse({ review_status: 'pending_review', owner_score: 60, total_score: 60, threshold: 70 });
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests[0]?.url).toContain('/heartbeat');
    expect(requests[1]?.url).toContain('/reviews/recommended');
    expect(requests[2]?.url).toContain('/status');
    expect(requests[3]?.url).toContain('/owner-verify');
    const body = JSON.parse(requests[3]?.body || '{}');
    expect(body.result).toBe('success');
    expect(body.commands_run).toEqual(['pytest -q']);
    expect(body.proof_payload.validation_cmd).toBe('pytest -q');
    expect(body.proof_payload.after_context.confirmation_mode).toBe('worker_auto');
    expect(body.artifacts.owner_reproduction_project_dir).toBe(projectRoot);
    expect(body.stdout_digest).toContain('3 passed');
    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalOwnerVerified).toBeGreaterThanOrEqual(1);
  });

  test('worker daemon auto-submits reviewer verification with a safe validation command', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);
    const projectRoot = join(root, 'demo-review-project');
    const projectFile = join(projectRoot, 'tests', 'test_review_auto.py');
    const p = _testHelpers.paths({ baseDir: root });
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(join(projectRoot, 'pyproject.toml'), '[project]\nname="demo-review"\n', 'utf8');
    writeFileSync(projectFile, 'print("ok")\n', 'utf8');
    mkdirSync(join(root, 'outbox'), { recursive: true });
    writeFileSync(p.outbox, `${JSON.stringify({
      eventId: 'evt_review_auto_1',
      deviceId: 'device-test_cc',
      agent: 'claude-code',
      fingerprint: 'fp_review_auto_1',
      eventType: 'post_tool_error',
      occurredAt: '2026-04-30T00:00:00Z',
      sanitizedMessage: 'pytest failed in test_review_auto.py',
      toolContext: { filePath: projectFile, command: 'pytest -q' },
    })}\n`, 'utf8');

    const requests: { url: string; body?: string }[] = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command, options) => {
        expect(command).toBe('pytest -q');
        expect(options?.cwd).toBe(projectRoot);
        return { exitCode: 0, stdout: '3 passed', stderr: '' };
      },
      fetchImpl: async (url, init) => {
        requests.push({ url, body: init?.body ? String(init.body) : undefined });
        fetchCount++;
        if (fetchCount >= 4) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/reviews/recommended')) {
          return mockResponse({
            items: [{
              assignment_id: 'lease_review_1',
              answer: { id: 'a_review_1', content: 'Review me' },
              submission_run: {
                proof_payload: { summary: 'Run tests', validation_cmd: 'pytest -q', expected_output: '3 passed' },
                commands_run: ['npm install', 'pytest -q'],
              },
              project_hint: {
                fingerprint: 'fp_review_auto_1',
                event_type: 'post_tool_error',
                origin_device_id: 'device-test',
                origin_agent_type: 'claude-code',
                tool_context: { fileName: 'test_review_auto.py', command: 'pytest -q' },
              },
              automation_contract: { mode: 'auto', auto_run_allowed: true },
              automation_readiness: { status: 'ready', selected_command: 'pytest -q' },
            }],
            total: 1,
          });
        }
        if (url.includes('/reviews/lease_review_1/submit')) return mockResponse({ ok: true });
        if (url.includes('/status')) return mockResponse({ pending_owner_verifications: [] });
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests[1]?.url).toContain('/reviews/recommended');
    expect(requests[2]?.url).toContain('/reviews/lease_review_1/submit');
    const body = JSON.parse(requests[2]?.body || '{}');
    expect(body.result).toBe('success');
    expect(body.method).toBe('execution');
    expect(body.commands_run).toEqual(['pytest -q']);
    expect(body.proof_payload.validation_cmd).toBe('pytest -q');
    expect(body.proof_payload.after_context.review_mode).toBe('worker_auto');
    expect(body.proof_payload.after_context.validation_cwd).toBe(projectRoot);
    expect(body.artifacts.validation_workdir).toBe(projectRoot);
    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalReviewsSubmitted).toBeGreaterThanOrEqual(1);
  });

  test('worker daemon auto-submits owner verification from captured cwd when file path is missing', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);
    const projectRoot = join(root, 'demo-owner-cwd-project');
    const p = _testHelpers.paths({ baseDir: root });
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(join(projectRoot, 'pyproject.toml'), '[project]\nname="demo-owner-cwd"\n', 'utf8');
    mkdirSync(join(root, 'outbox'), { recursive: true });
    writeFileSync(p.outbox, `${JSON.stringify({
      eventId: 'evt_owner_auto_cwd_1',
      deviceId: 'device-test_cc',
      agent: 'claude-code',
      fingerprint: 'fp_owner_auto_cwd_1',
      eventType: 'post_tool_error',
      occurredAt: '2026-04-30T00:00:00Z',
      sanitizedMessage: 'pytest failed in current workspace',
      localContext: { cwdHash: 'cwdhash-owner-auto-1' },
      toolContext: { cwd: projectRoot, command: 'pytest -q' },
    })}\n`, 'utf8');

    const requests: { url: string; body?: string }[] = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command, options) => {
        expect(command).toBe('pytest -q');
        expect(options?.cwd).toBe(projectRoot);
        return { exitCode: 0, stdout: '3 passed', stderr: '' };
      },
      fetchImpl: async (url, init) => {
        requests.push({ url, body: init?.body ? String(init.body) : undefined });
        fetchCount++;
        if (fetchCount >= 3) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/status')) {
          return mockResponse({
            pending_owner_verifications: [{
              bounty_id: 'b_owner_cwd_1',
              answer_id: 'a_owner_cwd_1',
              title: 'pytest owner auto via cwd',
              solution_summary: 'Run tests again',
              submitted_at: '2026-04-30T00:00:00Z',
              deadline_at: '2026-05-02T00:00:00Z',
              validation_cmd: 'pytest -q',
              expected_output: '3 passed',
              commands_run: ['pytest -q'],
              project_hint: {
                fingerprint: 'fp_owner_auto_cwd_1',
                event_type: 'post_tool_error',
                cwd_hash: 'cwdhash-owner-auto-1',
                origin_agent_type: 'claude-code',
                tool_context: { command: 'pytest -q' },
              },
              automation_contract: { mode: 'auto', auto_run_allowed: true },
              automation_readiness: { status: 'ready', selected_command: 'pytest -q' },
            }],
          });
        }
        if (url.includes('/owner-verify')) return mockResponse({ review_status: 'pending_review', owner_score: 60, total_score: 60, threshold: 70 });
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests[3]?.url).toContain('/owner-verify');
    const body = JSON.parse(requests[3]?.body || '{}');
    expect(body.artifacts.owner_reproduction_project_dir).toBe(projectRoot);
    expect(body.proof_payload.after_context.local_context.project_dir).toBe(projectRoot);
  });

  test('worker daemon writes owner prompt when platform routes execution back to the origin machine', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const requests = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command) => {
        throw new Error(`unexpected exec: ${command}`);
      },
      fetchImpl: async (url) => {
        requests.push(url);
        fetchCount++;
        if (fetchCount >= 2) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/status')) {
          return mockResponse({
            pending_owner_verifications: [{
              bounty_id: 'b_owner_prompt',
              answer_id: 'a_owner_prompt',
              title: 'prompt owner on origin machine',
              solution_summary: 'Please verify on the original machine',
              submitted_at: '2026-04-30T00:00:00Z',
              deadline_at: '2026-05-02T00:00:00Z',
              execution_decision: {
                decision: 'ask_user_run',
                phase: 'owner_verification',
                current_profile_is_target: true,
                target_route: {
                  profile_id: 'prof-owner',
                  device_id: 'device-owner',
                  agent_type: 'claude-code',
                },
              },
            }],
          });
        }
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(requests.some(url => url.includes('/owner-verify'))).toBe(false);
    expect(io.output).toContain('owner-prompt 待人工确认 b_owner_prompt/a_owner_prompt');
    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalOwnerSkipped).toBeGreaterThanOrEqual(1);
  });

  test('worker daemon skips owner verification when only unsafe commands are available', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const requests: string[] = [];
    const execSpy = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command) => {
        execSpy.push(command);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      fetchImpl: async (url) => {
        requests.push(url);
        fetchCount++;
        if (fetchCount >= 2) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/status')) {
          return mockResponse({
            pending_owner_verifications: [{
              bounty_id: 'b_owner_unsafe',
              answer_id: 'a_owner_unsafe',
              title: 'unsafe owner auto',
              solution_summary: 'Validation command: npm install left-pad',
              submitted_at: '2026-04-30T00:00:00Z',
              deadline_at: '2026-05-02T00:00:00Z',
              validation_cmd: 'npm install left-pad',
              commands_run: ['npm install left-pad'],
            }],
          });
        }
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(execSpy).toHaveLength(0);
    expect(requests.some(url => url.includes('/owner-verify'))).toBe(false);
    expect(io.output).toContain('无可自动执行的验证命令');
    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalOwnerSkipped).toBeGreaterThanOrEqual(1);
  });

  test('worker daemon skips owner verification when command is safe but not a real validation', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const requests: string[] = [];
    const execSpy = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command) => {
        execSpy.push(command);
        return { exitCode: 0, stdout: 'Python 3.12.0', stderr: '' };
      },
      fetchImpl: async (url) => {
        requests.push(url);
        fetchCount++;
        if (fetchCount >= 2) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/status')) {
          return mockResponse({
            pending_owner_verifications: [{
              bounty_id: 'b_owner_safe_skip',
              answer_id: 'a_owner_safe_skip',
              title: 'safe but meaningless owner auto',
              solution_summary: 'Validation command: python --version',
              submitted_at: '2026-04-30T00:00:00Z',
              deadline_at: '2026-05-02T00:00:00Z',
              validation_cmd: 'python --version',
              commands_run: ['python --version'],
            }],
          });
        }
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(execSpy).toHaveLength(0);
    expect(requests.some(url => url.includes('/owner-verify'))).toBe(false);
    expect(io.output).toContain('无可自动执行的验证命令');
    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalOwnerSkipped).toBeGreaterThanOrEqual(1);
  });

  test('worker daemon skips owner verification when platform marks the answer as manual-only', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const requests: string[] = [];
    const execSpy = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command) => {
        execSpy.push(command);
        return { exitCode: 0, stdout: '3 passed', stderr: '' };
      },
      fetchImpl: async (url) => {
        requests.push(url);
        fetchCount++;
        if (fetchCount >= 2) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/status')) {
          return mockResponse({
            pending_owner_verifications: [{
              bounty_id: 'b_owner_manual_only',
              answer_id: 'a_owner_manual_only',
              title: 'manual only owner auto',
              solution_summary: 'Run tests again',
              submitted_at: '2026-04-30T00:00:00Z',
              deadline_at: '2026-05-02T00:00:00Z',
              validation_cmd: 'pytest -q',
              commands_run: ['pytest -q'],
              automation_contract: { mode: 'manual_only', auto_run_allowed: false },
              automation_readiness: {
                status: 'degraded',
                selected_command: 'pytest -q',
                warning_reasons: ['missing_project_locator_hint'],
              },
            }],
          });
        }
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(execSpy).toHaveLength(0);
    expect(requests.some(url => url.includes('/owner-verify'))).toBe(false);
    expect(io.output).toContain('平台已标记为 manual-only');
  });

  test('worker daemon skips reviewer verification when command is safe but not a real validation', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const requests: { url: string; body?: string }[] = [];
    const execSpy = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command) => {
        execSpy.push(command);
        return { exitCode: 0, stdout: 'Python 3.12.0', stderr: '' };
      },
      fetchImpl: async (url, init) => {
        requests.push({ url, body: init?.body ? String(init.body) : undefined });
        fetchCount++;
        if (fetchCount >= 3) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/reviews/recommended')) {
          return mockResponse({
            items: [{
              assignment_id: 'lease_review_safe_skip',
              answer: { id: 'a_review_safe_skip', content: 'Review me safely' },
              submission_run: {
                proof_payload: {
                  summary: 'Use python --version',
                  validation_cmd: 'python --version',
                  expected_output: 'Python 3.12.0',
                },
                commands_run: ['python --version'],
              },
            }],
            total: 1,
          });
        }
        if (url.includes('/status')) return mockResponse({ pending_owner_verifications: [] });
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(execSpy).toHaveLength(0);
    expect(requests.some(req => req.url.includes('/reviews/lease_review_safe_skip/submit'))).toBe(false);
    expect(io.output).toContain('无可自动执行的验证命令');
    const wState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(wState.totalReviewSkipped).toBeGreaterThanOrEqual(1);
  });

  test('worker daemon skips reviewer verification when platform marks the answer as manual-only', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const requests: { url: string; body?: string }[] = [];
    const execSpy = [];
    let fetchCount = 0;
    const io = createIo();
    const code = await agentMain(['worker', 'daemon', '--worker-interval', '10'], {
      baseDir: root,
      execImpl: (command) => {
        execSpy.push(command);
        return { exitCode: 0, stdout: '3 passed', stderr: '' };
      },
      fetchImpl: async (url, init) => {
        requests.push({ url, body: init?.body ? String(init.body) : undefined });
        fetchCount++;
        if (fetchCount >= 3) {
          const config = _testHelpers.loadConfig({ baseDir: root });
          config.workerEnabled = false;
          _testHelpers.saveConfig(config, { baseDir: root });
        }
        if (url.includes('/heartbeat')) return mockResponse({ recommended_bounties: [] });
        if (url.includes('/reviews/recommended')) {
          return mockResponse({
            items: [{
              assignment_id: 'lease_review_manual_only',
              answer: { id: 'a_review_manual_only', content: 'Review me manually' },
              submission_run: {
                proof_payload: { validation_cmd: 'pytest -q', expected_output: '3 passed' },
                commands_run: ['pytest -q'],
              },
              project_hint: {},
              automation_contract: { mode: 'manual_only', auto_run_allowed: false },
              automation_readiness: {
                status: 'degraded',
                selected_command: 'pytest -q',
                warning_reasons: ['missing_project_locator_hint'],
              },
            }],
            total: 1,
          });
        }
        if (url.includes('/status')) return mockResponse({ pending_owner_verifications: [] });
        return mockResponse({});
      },
    }, io.io);

    expect(code).toBe(0);
    expect(execSpy).toHaveLength(0);
    expect(requests.some(({ url }) => url.includes('/reviews/lease_review_manual_only/submit'))).toBe(false);
    expect(io.output).toContain('平台已标记为 manual-only');
  });

  test('worker start waits for daemon readiness and reports running state', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const spawn = createSpawnStub(({ pid }) => {
      queueMicrotask(() => {
        const state = _testHelpers.loadWorkerState({ baseDir: root });
        state.enabled = true;
        state.status = 'running';
        state.pid = process.pid;
        state.startedAt = state.startedAt || new Date().toISOString();
        _testHelpers.saveWorkerState(state, { baseDir: root });
      });
    });

    const io = createIo();
    const code = await agentMain(['worker', 'start'], {
      baseDir: root,
      homeDir: root,
      spawnImpl: spawn.spawnImpl,
      workerStartTimeoutMs: 50,
      workerStartPollMs: 1,
    }, io.io);

    expect(code).toBe(0);
    const payload = JSON.parse(io.output);
    expect(payload.ok).toBe(true);
    expect(payload.started).toBe(true);
    expect(payload.worker.status).toBe('running');
    expect(payload.worker.pid).toBe(process.pid);
    expect(spawn.calls).toHaveLength(1);
  });

  test('worker start retries with direct node launch when cmd launch never becomes ready', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const spawn = createSpawnStub(({ command, pid }) => {
      if (command === process.execPath) {
        queueMicrotask(() => {
          const state = _testHelpers.loadWorkerState({ baseDir: root });
          state.enabled = true;
          state.status = 'running';
          state.pid = process.pid;
          state.startedAt = state.startedAt || new Date().toISOString();
          _testHelpers.saveWorkerState(state, { baseDir: root });
        });
      }
    });

    const io = createIo();
    const code = await agentMain(['worker', 'start'], {
      baseDir: root,
      homeDir: root,
      spawnImpl: spawn.spawnImpl,
      workerStartTimeoutMs: 50,
      workerStartPollMs: 1,
    }, io.io);

    expect(code).toBe(0);
    const payload = JSON.parse(io.output);
    expect(payload.ok).toBe(true);
    expect(payload.started).toBe(true);
    expect(payload.launchMode).toBe('node');
    expect(spawn.calls).toHaveLength(2);
    expect(spawn.calls[0]?.command).toContain('cmd');
    expect(spawn.calls[1]?.command).toBe(process.execPath);
  });

  test('worker start reports pending instead of false failure for slow daemon startup', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const alivePids = new Set<number>();
    const spawn = createSpawnStub(({ command, pid }) => {
      if (command === process.execPath) {
        alivePids.add(pid);
        setTimeout(() => {
          const state = _testHelpers.loadWorkerState({ baseDir: root });
          state.enabled = true;
          state.status = 'running';
          state.pid = process.pid;
          state.startedAt = state.startedAt || new Date().toISOString();
          _testHelpers.saveWorkerState(state, { baseDir: root });
          alivePids.delete(pid);
        }, 60);
      }
    });

    const io = createIo();
    const code = await agentMain(['worker', 'start'], {
      baseDir: root,
      homeDir: root,
      spawnImpl: spawn.spawnImpl,
      isProcessAliveImpl: (pid: number) => alivePids.has(pid) || pid === process.pid,
      workerStartTimeoutMs: 20,
      workerStartPollMs: 1,
    }, io.io);

    expect(code).toBe(0);
    const payload = JSON.parse(io.output);
    expect(payload.ok).toBe(true);
    expect(payload.pending).toBe(true);
    expect(payload.error).toBeUndefined();
    expect(payload.worker.status).toBe('starting');
    expect(payload.worker.lastError).toBeNull();

    await new Promise(resolve => setTimeout(resolve, 100));
    const finalState = _testHelpers.loadWorkerState({ baseDir: root });
    expect(finalState.status).toBe('running');
    expect(finalState.lastError).toBeNull();
  });

  test('worker start fails cleanly instead of leaving stuck starting state', async () => {
    const root = createTempRoot();
    roots.push(root);
    setupWorkerConfig(root);

    const spawn = createSpawnStub();
    const io = createIo();
    const code = await agentMain(['worker', 'start'], {
      baseDir: root,
      homeDir: root,
      spawnImpl: spawn.spawnImpl,
      isProcessAliveImpl: () => false,
      workerStartTimeoutMs: 10,
      workerStartPollMs: 1,
    }, io.io);

    expect(code).toBe(1);
    const payload = JSON.parse(io.output);
    expect(payload.ok).toBe(false);
    expect(payload.worker.status).toBe('stopped');
    expect(payload.worker.pid).toBeNull();
    expect(String(payload.worker.lastError || '')).toContain('running');
    expect(spawn.calls).toHaveLength(2);
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
    const spawn = createSpawnStub(() => {
      queueMicrotask(() => {
        const state = _testHelpers.loadWorkerState({ baseDir: root });
        state.enabled = true;
        state.status = 'running';
        state.pid = process.pid;
        state.startedAt = state.startedAt || new Date().toISOString();
        _testHelpers.saveWorkerState(state, { baseDir: root });
      });
    });
    setupWorkerConfig(root, { authToken: undefined });

    const io = createIo();
    const code = await agentMain(['bind', '--code', '123456'], {
      baseDir: root,
      homeDir: root,
      spawnImpl: spawn.spawnImpl,
      fetchImpl: async () => mockResponse({ api_key: 'ak_test_123', profile_id: 'prof_win' }),
    }, io.io);

    expect(code).toBe(0);
    expect(io.output).toContain('绑定成功');
    expect(io.output).toContain('Worker 互助循环: 已启动');
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]?.args.join(' ')).toContain('worker daemon');
    expect(_testHelpers.loadConfig({ baseDir: root }).profileId).toBe('prof_win');
  });
});
