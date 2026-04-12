const DEFAULT_COMMUNITY_ORIGIN = 'https://aicoevo.net';

function normalizeOrigin(value?: string | null): string {
  if (!value) return DEFAULT_COMMUNITY_ORIGIN;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_COMMUNITY_ORIGIN;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function getCommunityWebOrigin(): string {
  return normalizeOrigin(
    process.env.AICOEVO_WEB_ORIGIN
    || process.env.AICOEVO_BASE_URL
    || process.env.AICOEVO_ORIGIN,
  );
}

export function getCommunityApiBase(): string {
  return `${getCommunityWebOrigin()}/api/v1`;
}

export function buildCommunityClaimUrl(token: string): string {
  return `${getCommunityWebOrigin()}/claim?t=${encodeURIComponent(token)}`;
}

export const _testHelpers = {
  normalizeOrigin,
};
