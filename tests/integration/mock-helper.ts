import { _test } from '../../src/executor/index';

/** Mock 响应配置 */
export interface MockResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

/**
 * 创建命令 mock 函数
 * 支持精确匹配和部分前缀匹配（cmd.startsWith）
 */
export function createCommandMock(responses: Map<string, MockResponse>) {
  return (cmd: string, _opts: any): Buffer => {
    // 精确匹配
    const exact = responses.get(cmd);
    if (exact) return buildResult(exact);

    // 前缀匹配（去掉末尾参数差异）
    for (const [key, resp] of responses) {
      if (cmd.startsWith(key) || key.startsWith(cmd)) {
        return buildResult(resp);
      }
    }

    // 默认：命令未找到
    const err: any = new Error('not found');
    err.status = 1;
    err.stdout = Buffer.alloc(0);
    err.stderr = Buffer.from(`'${cmd.split(' ')[0]}' is not recognized`);
    throw err;
  };
}

function buildResult(resp: MockResponse): Buffer {
  if (resp.exitCode !== undefined && resp.exitCode !== 0) {
    const err: any = new Error('command failed');
    err.status = resp.exitCode;
    err.stdout = resp.stdout ? Buffer.from(resp.stdout) : Buffer.alloc(0);
    err.stderr = resp.stderr ? Buffer.from(resp.stderr) : Buffer.alloc(0);
    throw err;
  }
  return Buffer.from(resp.stdout || '');
}

/** 设置 mock */
export function setupMock(responses: Map<string, MockResponse>) {
  _test.mockExecSync = createCommandMock(responses);
}

/** 清除 mock */
export function teardownMock() {
  _test.mockExecSync = null;
  _test.mockExistsSync = null;
}

/**
 * 临时覆盖环境变量，执行完后恢复
 */
export async function withEnv(
  vars: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const old: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    old[key] = process.env[key];
    process.env[key] = vars[key];
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (old[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = old[key];
      }
    }
  }
}
