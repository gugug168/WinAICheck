import { describe, expect, test } from 'bun:test';
import { _testHelpers, buildCommunityClaimUrl } from '../src/web/community-config';

describe('community-config helper', () => {
  test('默认使用当前线上可达的 https 地址', () => {
    expect(buildCommunityClaimUrl('abc123')).toBe('https://aicoevo.net/claim?t=abc123');
  });

  test('会清理末尾斜杠并保留协议', () => {
    expect(_testHelpers.normalizeOrigin('https://aicoevo.net/')).toBe('https://aicoevo.net');
    expect(_testHelpers.normalizeOrigin('http://aicoevo.net///')).toBe('http://aicoevo.net');
  });

  test('未写协议时默认补 https，方便后续切换到 TLS', () => {
    expect(_testHelpers.normalizeOrigin('aicoevo.net')).toBe('https://aicoevo.net');
  });
});
