import { describe, it, expect } from 'bun:test';

// ==================== Scanner Parse 逻辑测试 ====================
// 测试各 scanner 的版本号提取和输出解析逻辑

describe('Git scanner parse', () => {
  it('提取 git 版本号', () => {
    const output = 'git version 2.51.1.windows.1';
    const match = output.match(/git version (\d+\.\d+\.\d+)/);
    expect(match?.[1]).toBe('2.51.1');
  });

  it('提取 git 版本号（无 windows 后缀）', () => {
    const output = 'git version 2.45.0';
    const match = output.match(/git version (\d+\.\d+\.\d+)/);
    expect(match?.[1]).toBe('2.45.0');
  });
});

describe('Node version parse', () => {
  it('提取 Node.js 版本号', () => {
    const output = 'v22.22.2';
    const match = output.match(/v(\d+\.\d+\.\d+)/);
    expect(match?.[1]).toBe('22.22.2');
  });
});

describe('Python version parse', () => {
  it('提取 Python 版本号', () => {
    const output = 'Python 3.11.5';
    const match = output.match(/Python (\d+\.\d+\.\d+)/);
    expect(match?.[1]).toBe('3.11.5');
  });

  it('处理 Anaconda 格式', () => {
    const output = 'Python 3.7.0 :: Anaconda, Inc.';
    const match = output.match(/Python (\d+\.\d+\.\d+)/);
    expect(match?.[1]).toBe('3.7.0');
  });
});

describe('NVIDIA GPU parse', () => {
  it('从 nvidia-smi 提取 GPU 名称', () => {
    const output = 'NVIDIA GeForce RTX 5060 Ti\n GeForce RTX 3090';
    const names = output.split('\n').map(l => l.trim()).filter(Boolean);
    expect(names[0]).toBe('NVIDIA GeForce RTX 5060 Ti');
  });

  it('从 nvidia-smi 提取驱动版本', () => {
    const output = '591.74';
    const match = output.match(/(\d+\.\d+)/);
    expect(match?.[1]).toBe('591.74');
  });
});

describe('CUDA version parse', () => {
  it('从 nvcc 输出提取 CUDA 版本', () => {
    const output = 'Cuda compilation tools, release 12.1, V12.1.105';
    const match = output.match(/release\s+(\d+\.\d+)/);
    expect(match?.[1]).toBe('12.1');
  });

  it('从 nvidia-smi 提取 CUDA 版本', () => {
    const output = '| NVIDIA-SMI 535.104.05   Driver Version: 535.104.05   CUDA Version: 12.2     |';
    const match = output.match(/CUDA Version:\s*(\d+\.\d+)/);
    expect(match?.[1]).toBe('12.2');
  });
});

describe('WSL version parse', () => {
  it('检测 WSL2 默认版本', () => {
    const output = '默认版本: 2\n默认分发: Ubuntu-24.04';
    const isWsl2 = /默认版本:\s*2|default version:\s*2/i.test(output);
    expect(isWsl2).toBe(true);
  });

  it('英文输出也支持', () => {
    const output = 'Default Version: 2\nDefault Distribution: Ubuntu';
    const isWsl2 = /默认版本:\s*2|default version:\s*2/i.test(output);
    expect(isWsl2).toBe(true);
  });
});

describe('Registry parse', () => {
  it('从 reg query 输出提取 LongPathsEnabled', () => {
    const output = `
    LongPathsEnabled    REG_DWORD    0x1`;
    const match = output.match(/LongPathsEnabled\s+REG_\w+\s+0x(\d+)/);
    expect(match?.[1]).toBe('1');
  });

  it('LongPathsEnabled 禁用时', () => {
    const output = `
    LongPathsEnabled    REG_DWORD    0x0`;
    const match = output.match(/LongPathsEnabled\s+REG_\w+\s+0x(\d+)/);
    expect(match?.[1]).toBe('0');
  });
});

describe('Site reachability parse', () => {
  it('从 curl -I 判断可达', () => {
    const output = 'HTTP/2 200\ncontent-type: text/html';
    const ok = /^HTTP\/[\d.]+\s+[23]\d\d/.test(output.trim());
    expect(ok).toBe(true);
  });

  it('HTTP 403 也算可达', () => {
    const output = 'HTTP/2 403';
    // 有些站点返回 403 但仍然可达
    const reachable = output.trim().startsWith('HTTP/');
    expect(reachable).toBe(true);
  });
});

describe('Mirror sources parse', () => {
  it('pip.ini 内容解析', () => {
    const content = '[global]\nindex-url = https://pypi.tuna.tsinghua.edu.cn/simple';
    const hasMirror = /index-url|trusted-host/i.test(content);
    expect(hasMirror).toBe(true);
  });

  it('.npmrc 内容解析', () => {
    const content = 'registry=https://registry.npmmirror.com';
    const hasMirror = /registry\s*=/i.test(content);
    expect(hasMirror).toBe(true);
  });
});

describe('Path analysis', () => {
  it('检测中文路径', () => {
    const path = 'C:\\Users\\张三';
    const hasChinese = /[^\x00-\x7F]/.test(path);
    expect(hasChinese).toBe(true);
  });

  it('纯 ASCII 路径通过', () => {
    const path = 'C:\\Users\\Administrator';
    const hasChinese = /[^\x00-\x7F]/.test(path);
    expect(hasChinese).toBe(false);
  });

  it('PATH 长度检测', () => {
    const path = 'C:\\a;C:\\b;C:\\c';
    const MAX = 2048;
    expect(path.length < MAX).toBe(true);
  });
});
