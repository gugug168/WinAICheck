param(
  [string]$ApiBase = "http://localhost:8000",
  [string]$Email = "winaicheck-smoke@example.com",
  [string]$Code = "",
  [string]$Agent = "claude-code"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $repo "bin\agent-lite.js"
if (-not (Test-Path $runner)) {
  throw "找不到轻量 runner: $runner"
}

$tempHome = Join-Path ([System.IO.Path]::GetTempPath()) ("winaicheck-agent-smoke-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempHome | Out-Null

$oldApi = $env:AICOEVO_API_BASE
$oldHome = $env:HOME
$oldUserProfile = $env:USERPROFILE

function Invoke-AgentLite {
  param([string[]]$Arguments)
  $output = & node $runner @Arguments 2>&1
  $text = ($output | Out-String).Trim()
  if ($text) {
    Write-Host $text
  }
  if ($LASTEXITCODE -ne 0) {
    throw "agent-lite failed ($LASTEXITCODE): node $runner $($Arguments -join ' ')"
  }
  return $text
}

try {
  $env:AICOEVO_API_BASE = $ApiBase
  $env:HOME = $tempHome
  $env:USERPROFILE = $tempHome

  Write-Host "WinAICheck Agent Loop Smoke"
  Write-Host "API: $ApiBase"
  Write-Host "Email: $Email"
  Write-Host "Home: $tempHome"

  $startText = Invoke-AgentLite -Arguments @("auth", "start", "--email", $Email)

  if (-not $Code) {
    $match = [regex]::Match(($startText | Out-String), "([0-9]{6})")
    if ($match.Success) {
      $Code = $match.Groups[1].Value
    } else {
      throw "No -Code was provided and no debug_code was found. Re-run with -Code 123456."
    }
  }

  Invoke-AgentLite -Arguments @("auth", "verify", "--email", $Email, "--code", $Code) | Out-Null
  Invoke-AgentLite -Arguments @("capture", "--agent", $Agent, "--message", "MCP config JSON parse error with OPENAI_API_KEY=sk-abc123def456ghi789jkl012mno345 at C:\Users\Alice\repo") | Out-Null
  Invoke-AgentLite -Arguments @("sync") | Out-Null

  Write-Host "`nREMOTE UPLOADS"
  Invoke-AgentLite -Arguments @("uploads", "--remote") | Out-Null

  Write-Host "`nLOCAL ADVICE"
  Invoke-AgentLite -Arguments @("advice", "--format", "markdown") | Out-Null

  Write-Host "`nSmoke completed. Temp home kept for inspection: $tempHome"
} finally {
  $env:AICOEVO_API_BASE = $oldApi
  $env:HOME = $oldHome
  $env:USERPROFILE = $oldUserProfile
}
