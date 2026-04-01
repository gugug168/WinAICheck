#!/usr/bin/env node
/**
 * WinAICheck npm wrapper
 * Downloads WinAICheck.exe from GitHub Releases and runs it.
 *
 * Usage: npx winaicheck
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const REPO = "gugug168/WinAICheck";
const EXE_NAME = "WinAICheck.exe";
const CACHE_DIR = path.join(process.env.USERPROFILE || process.env.HOME, ".winaicheck");

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
        fs.unlinkSync(dest);
        reject(e);
      });
    };
    follow(url, 0);
  });
}

async function main() {
  // Ensure cache dir exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const exePath = path.join(CACHE_DIR, EXE_NAME);

  // Get latest release info
  console.log("WinAICheck: 获取最新版本...");
  const release = await fetchJSON(`https://api.github.com/repos/${REPO}//releases/latest`);
  const version = release.tag_name;

  const asset = release.assets.find((a) => a.name === EXE_NAME);
  if (!asset) {
    console.error(`WinAICheck: 未找到 ${EXE_NAME}，请前往 https://github.com/${REPO}/releases 手动下载`);
    process.exit(1);
  }

  // Check if cached version matches
  const versionFile = path.join(CACHE_DIR, "version.txt");
  let needDownload = true;
  if (fs.existsSync(exePath) && fs.existsSync(versionFile)) {
    const cached = fs.readFileSync(versionFile, "utf8").trim();
    if (cached === version) {
      needDownload = false;
    }
  }

  if (needDownload) {
    console.log(`WinAICheck: 下载 v${version}...`);
    await downloadFile(asset.browser_download_url, exePath);
    fs.writeFileSync(versionFile, version);
    const size = Math.round(fs.statSync(exePath).size / 1024 / 1024);
    console.log(`WinAICheck: 已下载 ${size}MB`);
  } else {
    console.log(`WinAICheck: 使用缓存 v${version}`);
  }

  // Run the exe
  console.log("");
  try {
    execFileSync(exePath, process.argv.slice(2), {
      stdio: "inherit",
      windowsHide: false,
    });
  } catch (e) {
    // exe may set non-zero exit code, that's ok
    if (e.status !== undefined) process.exit(e.status);
    throw e;
  }
}

main().catch((e) => {
  console.error("WinAICheck 错误:", e.message);
  console.error(`请手动下载: https://github.com/${REPO}/releases`);
  process.exit(1);
});
