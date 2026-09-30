param(
    [string] $Root = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'
$outerPath = Join-Path $Root 'redux-tweak.mod'
$innerPath = Join-Path $Root 'redux-tweak/descriptor.mod'
$upstreamPath = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'MEIOUandTaxesPublicFork/MEIOUandTaxes1.mod'

if (-not (Test-Path -LiteralPath $outerPath -PathType Leaf)) {
    'FAIL: redux-tweak.mod missing'
    exit 1
}
if (-not (Test-Path -LiteralPath $innerPath -PathType Leaf)) {
    'FAIL: descriptor.mod missing'
    exit 1
}

$outer = [IO.File]::ReadAllText($outerPath)
$inner = [IO.File]::ReadAllText($innerPath)
$upstream = [IO.File]::ReadAllText($upstreamPath)
$withoutPath = [regex]::Replace($outer, '(?m)^path="mod/redux-tweak"\r?\n?', '')
$name = [regex]::Match($upstream, '(?m)^name="([^"]+)"').Groups[1].Value
$version = [regex]::Match($upstream, '(?m)^supported_version="([^"]+)"').Groups[1].Value

if ($withoutPath -cne $inner -or
    $outer -notmatch '(?m)^path="mod/redux-tweak"$' -or
    $inner -notmatch [regex]::Escape("`"$name`"") -or
    $inner -notmatch [regex]::Escape("supported_version=`"$version`"") -or
    $outer -match '(?m)^replace_path=') {
    'FAIL: descriptor mismatch'
    exit 1
}

'PASS: descriptor parity, dependency, version, path, no replace_path'
