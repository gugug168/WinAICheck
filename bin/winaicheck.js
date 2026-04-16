#!/usr/bin/env node
/**
 * WinAICheck npm wrapper
 * Downloads WinAICheck.exe from GitHub Releases and runs it.
 *
 * Usage: npx winaicheck
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { main as agentMain } from './agent-lite.js';

const REPO = 'gugug168/WinAICheck';
const EXE_NAME = 'WinAICheck.exe';
const CACHE_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.winaicheck');
const STATE_DIR = path.join(CACHE_DIR, 'state');
const REMOTE_VERSION_URL = 'https://raw.githubusercontent.com/gugug168/WinAICheck/main/VERSION';
const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const follow = (u, redirects) => {
      if (redirects > 5) return reject(new Error("Too many redirects"));
      mod.get(u, { headers: { "User-Agent": "WinAICheck-npm" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${u}`));
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error("Invalid JSON")); }
        });
      }).on("error", reject);
    };
    follow(url, 0);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const follow = (u, redirects) => {
      if (redirects > 5) return reject(new Error("Too many redirects"));
      mod.get(u, { headers: { "User-Agent": "WinAICheck-npm" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }).on("error", (e) => {
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
        reject(e);
      });
    };
    follow(url, 0);
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'agent') {
    const code = await agentMain(argv.slice(1));
    if (code) process.exit(code);
    return;
  }

  // 检测 Bun 是否可用 + 源码是否存在 → 直接运行，无需下载 exe
  const srcMain = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.ts');
  if (fs.existsSync(srcMain)) {
    let bunAvailable = false;
    try {
      execFileSync('where.exe', ['bun'], { timeout: 3000, windowsHide: true });
      bunAvailable = true;
    } catch {
      // Bun 不可用，继续走 exe 下载流程
    }
    if (bunAvailable) {
      console.log('WinAICheck: 检测到 Bun，直接从源码启动...');
      try {
        execFileSync('bun', ['run', srcMain, ...argv], {
          stdio: 'inherit',
          windowsHide: false,
        });
        return; // Bun 成功启动，退出
      } catch (e) {
        // Bun 启动失败，继续走 exe 下载流程
        if (e.status !== undefined) {
          console.error(`WinAICheck: Bun 启动失败 (${e.status})，回退到 exe...`);
        }
      }
    }
  }

  const exePath = path.join(CACHE_DIR, EXE_NAME);

  // Lightweight version check: fetch VERSION file (~10 bytes) instead of full GitHub API
  const versionFile = path.join(CACHE_DIR, "version.txt");
  const checkCacheFile = path.join(STATE_DIR, "last-update-check");
  let cachedVersion = '';
  let needDownload = true;

  if (fs.existsSync(exePath) && fs.existsSync(versionFile)) {
    cachedVersion = fs.readFileSync(versionFile, "utf8").trim();

    // Check rate-limited cache
    let skipCheck = false;
    try {
      if (fs.existsSync(checkCacheFile)) {
        const cache = JSON.parse(fs.readFileSync(checkCacheFile, 'utf8'));
        const age = Date.now() - (cache.ts || 0);
        if (age < VERSION_CHECK_INTERVAL_MS) {
          needDownload = cache.result !== 'UP_TO_DATE';
          skipCheck = true;
        }
      }
    } catch {}

    if (!skipCheck) {
      try {
        const remoteVersion = await new Promise((resolve, reject) => {
          https.get(REMOTE_VERSION_URL, { timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => resolve(body.trim()));
          }).on('error', reject);
        });

        if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

        if (remoteVersion === cachedVersion) {
          needDownload = false;
          fs.writeFileSync(checkCacheFile, JSON.stringify({ result: 'UP_TO_DATE', ts: Date.now() }));
        } else {
          console.log(`WinAICheck: 发现新版本 ${remoteVersion} (当前: ${cachedVersion})`);
          fs.writeFileSync(checkCacheFile, JSON.stringify({ result: 'UPGRADE_AVAILABLE', remote: remoteVersion, ts: Date.now() }));
        }
      } catch {
        // Network error, use cached exe
        needDownload = false;
      }
    }
  }

  if (needDownload) {
    // Full download: fetch GitHub release info
    console.log("WinAICheck: 获取最新版本...");
    const release = await fetchJSON(`https://api.github.com/repos/${REPO}/releases/latest`);
    const version = release.tag_name;

    const asset = release.assets.find((a) => a.name === EXE_NAME);
    if (!asset) {
      console.error(`WinAICheck: 未找到 ${EXE_NAME}，请前往 https://github.com/${REPO}/releases 手动下载`);
      process.exit(1);
    }

    console.log(`WinAICheck: 下载 v${version}...`);
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    await downloadFile(asset.browser_download_url, exePath);
    fs.writeFileSync(versionFile, version);
    const size = Math.round(fs.statSync(exePath).size / 1024 / 1024);
    console.log(`WinAICheck: 已下载 ${size}MB`);
  } else {
    console.log(`WinAICheck: 使用缓存 v${cachedVersion || 'unknown'}`);
  }

  // Run the exe
  console.log("");
  try {
    execFileSync(exePath, argv, {
      stdio: "inherit",
      windowsHide: false,
    });
  } catch (e) {
    // exe may set non-zero exit code, that's ok
    if (e.status !== undefined) process.exit(e.status);
    throw e;
  }
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  main().catch((e) => {
    console.error("WinAICheck 错误:", e.message);
    console.error(`请手动下载: https://github.com/${REPO}/releases`);
    process.exit(1);
  });
}
