import { describe, expect, test } from 'bun:test';
import { _testHelpers, requestRemoteJson } from '../src/web/remote-json';

describe('remote-json helper', () => {
  test('HTTPS 超时后会回退到 HTTP fetch', async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string) => {
      calls.push(input);
      if (input.startsWith('https://')) {
        throw new Error('socket disconnected before TLS connection was established');
      }
      return {
        status: 200,
        text: async () => '{"items":[{"title":"HTTP fallback ok"}]}',
      };
    };

    const result = await requestRemoteJson('https://aicoevo.net/api/v1/solutions?page_size=1', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, {
      fetchImpl,
    });

    expect(calls).toEqual([
      'https://aicoevo.net/api/v1/solutions?page_size=1',
      'http://aicoevo.net/api/v1/solutions?page_size=1',
    ]);
    expect(result.status).toBe(200);
    expect(result.data.items[0].title).toBe('HTTP fallback ok');
  });

  test('fetch 全部失败后会回退到 PowerShell', async () => {
    const powershellCalls: string[] = [];
    const fetchImpl = async () => {
      throw new Error('TLS handshake timeout');
    };

    const result = await requestRemoteJson('https://aicoevo.net/api/v1/stash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { hello: 'world' },
    }, {
      fetchImpl,
      runPowerShellImpl: (url) => {
        powershellCalls.push(url);
        return {
          status: 200,
          body: '{"token":"ps-fallback-token"}',
        };
      },
    });

    expect(powershellCalls).toEqual(['https://aicoevo.net/api/v1/stash']);
    expect(result.data.token).toBe('ps-fallback-token');
  });

  test('非网络错误不进入回退链路', async () => {
    const fetchImpl = async () => ({
      status: 200,
      text: async () => 'not-json',
    });

    await expect(requestRemoteJson('https://aicoevo.net/api/v1/stash', {
      method: 'POST',
    }, {
      fetchImpl,
      runPowerShellImpl: () => {
        throw new Error('should not be called');
      },
    })).rejects.toThrow();
  });

  test('只对 https 地址增加 http 候选', () => {
    expect(_testHelpers.buildCandidateUrls('https://aicoevo.net/api/v1/stash')).toEqual([
      'https://aicoevo.net/api/v1/stash',
      'http://aicoevo.net/api/v1/stash',
    ]);
    expect(_testHelpers.buildCandidateUrls('http://aicoevo.net/api/v1/stash')).toEqual([
      'http://aicoevo.net/api/v1/stash',
    ]);
  });
});
