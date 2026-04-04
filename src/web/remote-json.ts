import { execSync } from 'child_process';

type HttpMethod = 'GET' | 'POST';

type PowerShellResult = {
  status: number;
  body: string;
  error?: string;
};

type FetchResponseLike = {
  status: number;
  text(): Promise<string>;
};

type FetchImpl = (
  input: string,
  init: RequestInit,
) => Promise<FetchResponseLike>;

type PowerShellImpl = (
  url: string,
  method: HttpMethod,
  body?: unknown,
  headers?: Record<string, string>,
) => PowerShellResult;

type RequestRemoteJsonDeps = {
  fetchImpl?: FetchImpl;
  runPowerShellImpl?: PowerShellImpl;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5000;
const RETRYABLE_NETWORK_ERROR = /certificate|tls|ssl|econnreset|socket disconnected|timed out|timeout|abort/i;

export function runPowerShellHttpJson(
  url: string,
  method: HttpMethod,
  body?: unknown,
  headers: Record<string, string> = {},
): PowerShellResult {
  const bodyBase64 = body === undefined
    ? ''
    : Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
  const headersLiteral = Object.entries(headers)
    .map(([key, value]) => `'${key.replace(/'/g, "''")}'='${value.replace(/'/g, "''")}'`)
    .join('; ');

  const script = `
$ProgressPreference = 'SilentlyContinue'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
$headers = @{}
${headersLiteral ? `$headers = @{ ${headersLiteral} }` : ''}
$uri = '${url.replace(/'/g, "''")}'
$method = '${method}'
$bodyJson = ''
if ('${bodyBase64}') {
  $bodyJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${bodyBase64}'))
}
try {
  if ($method -eq 'POST') {
    $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri $uri -Method Post -Headers $headers -Body $bodyJson
  } else {
    $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri $uri -Method Get -Headers $headers
  }
  [pscustomobject]@{
    status = [int]$resp.StatusCode
    body = $resp.Content
  } | ConvertTo-Json -Compress -Depth 6
} catch {
  $status = 0
  $content = ''
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $content = $reader.ReadToEnd()
  } else {
    $content = $_.Exception.Message
  }
  [pscustomobject]@{
    status = $status
    body = $content
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress -Depth 6
}`;

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const stdout = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 12000,
  }).trim();

  const parsed = JSON.parse(stdout) as { status?: number; body?: string; error?: string };
  return {
    status: parsed.status ?? 0,
    body: parsed.body ?? '',
    error: parsed.error,
  };
}

function isRetryableNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_NETWORK_ERROR.test(message);
}

function buildCandidateUrls(url: string): string[] {
  if (!url.startsWith('https://')) return [url];
  return [url, url.replace(/^https:\/\//i, 'http://')];
}

async function attemptFetch(
  fetchImpl: FetchImpl,
  url: string,
  method: HttpMethod,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; data: any }> {
  const response = await fetchImpl(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : {},
  };
}

export async function requestRemoteJson(
  url: string,
  init: { method?: HttpMethod; headers?: Record<string, string>; body?: unknown },
  deps: RequestRemoteJsonDeps = {},
): Promise<{ status: number; data: any }> {
  const method = init.method || 'GET';
  const headers = init.headers || {};
  const fetchImpl = deps.fetchImpl || (fetch as FetchImpl);
  const runPowerShellImpl = deps.runPowerShellImpl || runPowerShellHttpJson;
  const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
  const candidates = buildCandidateUrls(url);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      return await attemptFetch(fetchImpl, candidate, method, headers, init.body, timeoutMs);
    } catch (error) {
      if (!isRetryableNetworkError(error)) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  for (const candidate of candidates) {
    try {
      const fallback = runPowerShellImpl(candidate, method, init.body, headers);
      const text = fallback.body?.trim();
      if (!text) {
        throw new Error(fallback.error || '远程服务无响应');
      }

      return {
        status: fallback.status || 200,
        data: JSON.parse(text),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('远程服务无响应');
}

export const _testHelpers = {
  buildCandidateUrls,
  isRetryableNetworkError,
};
