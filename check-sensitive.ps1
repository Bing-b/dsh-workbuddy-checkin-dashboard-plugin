#!/usr/bin/env pwsh
# ============================================================================
#  提交前敏感信息检查
#
#  用法：
#    pwsh ./check-sensitive.ps1          # 检查当前目录下会被 git 提交的文件
#    pwsh ./check-sensitive.ps1 -All     # 检查所有文件（含未被 git 跟踪的）
#
#  建议接到 git 钩子上，见文末安装说明。
# ============================================================================
param(
  [switch]$All
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 需要拦住的东西：真实账号 ID、昵称、密钥形态
$rules = @(
  # 上游 WorkBuddy 的账号 id 是 sha256 前 16 位十六进制；放宽到 12-64 位，覆盖同类实现
  @{ Name = '疑似账号 ID（12 位以上十六进制）'; Pattern = '(?<![0-9a-fA-F])[0-9a-f]{12,64}(?![0-9a-fA-F])' },
  @{ Name = '疑似 access token';            Pattern = 'sk-[A-Za-z0-9]{16,}' },
  @{ Name = 'Bearer 凭据';                  Pattern = 'Bearer\s+[A-Za-z0-9._-]{20,}' },
  @{ Name = '硬编码密码';                   Pattern = '(?i)(password|passwd|secret)\s*[:=]\s*["''][^"'']{6,}' },
  @{ Name = '私钥';                         Pattern = '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
  @{ Name = '手机号';                       Pattern = '(?<!\d)1[3-9]\d{9}(?!\d)' }
)

# 白名单：这些十六进制串是格式常量或图标色值，不是账号。按需增加，不要放宽上面的正则。
$allowList = @(
  'a8'                       # 密钥用法位掩码示例
)

# 只检查这些类型；二进制与依赖目录跳过
$includeExt = @('.js', '.mjs', '.cjs', '.ts', '.json', '.yml', '.yaml', '.md', '.svg', '.ps1')
$excludeDirs = @('node_modules', '.git', 'dist', '.vscode')

function Get-TargetFiles {
  if ($All) {
    Get-ChildItem -Recurse -File | Where-Object {
      $includeExt -contains $_.Extension -and
      -not ($excludeDirs | Where-Object { $_.FullName -match [regex]::Escape("$([IO.Path]::DirectorySeparatorChar)$_\$([IO.Path]::DirectorySeparatorChar)") })
    }
  } else {
    # 只查 git 会提交的文件（已跟踪 + 未忽略的新文件）
    git ls-files --cached --others --exclude-standard 2>$null |
      ForEach-Object {
        $full = Join-Path $root $_
        if ((Test-Path -LiteralPath $full) -and ($includeExt -contains [IO.Path]::GetExtension($full))) {
          Get-Item -LiteralPath $full
        }
      }
  }
}

$files = Get-TargetFiles
if (-not $files) {
  Write-Host '没有需要检查的文件。' -ForegroundColor DarkGray
  exit 0
}

$problems = @()
foreach ($file in $files) {
  $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $text) { continue }
  $lines = $text -split "`n"

  foreach ($rule in $rules) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -notmatch $rule.Pattern) { continue }

      # 命中后再看是否整串都在白名单里：命中段落里的每个十六进制串都要被豁免才算无害
      $hitText = $Matches[0]
      if ($allowList -contains $hitText) { continue }
      if ($rule.Name -like '*账号 ID*') {
        # 十六进制规则：逐个匹配，全部在白名单才跳过
        $tokens = [regex]::Matches($lines[$i], $rule.Pattern) | ForEach-Object { $_.Value }
        if ($tokens.Count -gt 0 -and ($tokens | Where-Object { $allowList -notcontains $_ }).Count -eq 0) { continue }
      }

      $problems += [pscustomobject]@{
        File    = $file.FullName.Replace($root + [IO.Path]::DirectorySeparatorChar, '')
        Line    = $i + 1
        Rule    = $rule.Name
        Snippet = $lines[$i].Trim()
      }
    }
  }
}

if ($problems.Count -eq 0) {
  Write-Host "✔ 已检查 $($files.Count) 个文件，未发现敏感信息。" -ForegroundColor Green
  exit 0
}

Write-Host "✘ 发现 $($problems.Count) 处可疑内容：" -ForegroundColor Red
Write-Host ''
foreach ($p in $problems) {
  Write-Host ("  {0}:{1}" -f $p.File, $p.Line) -ForegroundColor Yellow
  Write-Host ("    规则: {0}" -f $p.Rule) -ForegroundColor DarkYellow
  Write-Host ("    内容: {0}" -f $p.Snippet) -ForegroundColor Gray
  Write-Host ''
}
Write-Host '请确认上面每一处：真实账号 ID / 凭据必须删除或改成占位符。' -ForegroundColor Red
Write-Host '确实无害（例如测试用的假数据）时，用 git commit --no-verify 跳过。' -ForegroundColor DarkGray
exit 1

# ============================================================================
#  安装为 git 钩子（一次性）：
#
#    New-Item -ItemType Directory -Force .git/hooks | Out-Null
#    @'
#    #!/bin/sh
#    pwsh -NoProfile -File "$(git rev-parse --show-toplevel)/check-sensitive.ps1" || exit 1
#    '@ | Out-File -Encoding ascii .git/hooks/pre-commit
#
#  之后每次 git commit 都会先跑这个检查，发现问题直接拒绝提交。
# ============================================================================
