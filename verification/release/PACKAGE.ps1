param(
    [ValidateSet('Baseline', 'Build', 'Verify', 'Rollback')] [string] $Mode = 'Build',
    [string] $ArchivePath,
    [string] $BackupPath
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$version = [regex]::Match([IO.File]::ReadAllText((Join-Path $repo 'redux-tweak.mod')), '(?m)^version="(\d+\.\d+\.\d+)"').Groups[1].Value
if (-not $version) { throw 'Source release version is missing.' }
$recordDirectory = Join-Path $PSScriptRoot $version
if (-not $ArchivePath) { $ArchivePath = Join-Path $repo "dist/redux-tweak-$version.zip" }
$ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
$files = [ordered]@{
    'redux-tweak.mod' = 'redux-tweak.mod'
    'redux-tweak/descriptor.mod' = 'redux-tweak/descriptor.mod'
    'redux-tweak/common/custom_gui/ReduxSubjectSelection.txt' = 'redux-tweak/common/custom_gui/ReduxSubjectSelection.txt'
    'redux-tweak/common/scripted_effects/SYS-Construct.txt' = 'redux-tweak/common/scripted_effects/SYS-Construct.txt'
    'redux-tweak/interface/provinceview.gui' = 'redux-tweak/interface/provinceview.gui'
    'redux-tweak/localisation/redux-tweak_l_english.yml' = 'redux-tweak/localisation/redux-tweak_l_english.yml'
    'redux-tweak/decisions/ReduxSubjectSelection.txt' = 'redux-tweak/decisions/ReduxSubjectSelection.txt'
    'redux-tweak/customizable_localization/ReduxSubjectSelection.txt' = 'redux-tweak/customizable_localization/ReduxSubjectSelection.txt'
    'redux-tweak/common/scripted_triggers/ReduxSubjectSelection.txt' = 'redux-tweak/common/scripted_triggers/ReduxSubjectSelection.txt'
    'redux-tweak/common/scripted_effects/ReduxSubjectSelection.txt' = 'redux-tweak/common/scripted_effects/ReduxSubjectSelection.txt'
    'redux-tweak/common/scripted_effects/SYS-Prov.txt' = 'redux-tweak/common/scripted_effects/SYS-Prov.txt'
    'redux-tweak/common/on_actions/00_on_actions.txt' = 'redux-tweak/common/on_actions/00_on_actions.txt'
    'redux-tweak/LICENSE' = 'LICENSE'
}

$outer = [IO.File]::ReadAllText((Join-Path $repo 'redux-tweak.mod'))
$inner = [IO.File]::ReadAllText((Join-Path $repo 'redux-tweak/descriptor.mod'))
if ([regex]::Replace($outer, '(?m)^path="mod/redux-tweak"\r?\n?', '') -cne $inner -or
    $outer -notmatch '(?m)^path="mod/redux-tweak"\r?$' -or
    -not $outer.Contains('"MEIOU and Taxes v3.0"') -or
    -not $outer.Contains('"Pop Display"')) {
    throw 'Release descriptors differ or contain a nonportable path.'
}
foreach ($entry in $files.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath (Join-Path $repo $entry.Value) -PathType Leaf)) {
        throw "Missing source: $($entry.Value)"
    }
}

if ($Mode -eq 'Baseline') {
    $manifest = @($files.GetEnumerator() | ForEach-Object {
        $hash = (Get-FileHash -LiteralPath (Join-Path $repo $_.Value) -Algorithm SHA256).Hash
        "$hash  $($_.Key)"
    })
    New-Item -ItemType Directory -Path $recordDirectory -Force | Out-Null
    [IO.File]::WriteAllLines((Join-Path $recordDirectory 'source-hashes.txt'), $manifest)
    "PASS: BASELINE $($files.Count) source files; portable descriptor; version=$version; dependencies=2"
    exit 0
}

function Test-Archive([string] $Path) {
    $zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $names = @($zip.Entries | ForEach-Object FullName)
        if ($names.Count -ne $files.Count -or @($names | Select-Object -Unique).Count -ne $files.Count -or
            @(Compare-Object @($files.Keys) $names -CaseSensitive).Count -ne 0) {
            throw 'Archive entry list differs from the release allowlist.'
        }
        $manifest = foreach ($entry in $zip.Entries) {
            $stream = $entry.Open()
            try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) }
            finally { $stream.Dispose() }
            $expected = (Get-FileHash -LiteralPath (Join-Path $repo $files[$entry.FullName]) -Algorithm SHA256).Hash
            if ($hash -cne $expected) { throw "Archive bytes differ: $($entry.FullName)" }
            "$hash  $($entry.FullName)"
        }
        $baseline = [IO.File]::ReadAllLines((Join-Path $recordDirectory 'source-hashes.txt'))
        if (@(Compare-Object $baseline @($manifest) -CaseSensitive).Count -ne 0) {
            throw 'Source files changed since baseline.'
        }
    }
    finally { $zip.Dispose() }
}

if ($Mode -eq 'Rollback') {
    if (Test-Path -LiteralPath $ArchivePath) { throw 'Rolled-back archive still exists.' }
    Test-Archive ([IO.Path]::GetFullPath($BackupPath))
    'PASS: ROLLBACK test archive removed; backup verified; source files unchanged'
    exit 0
}

if ($Mode -eq 'Build') {
    if (Test-Path -LiteralPath $ArchivePath) { throw 'Release archive already exists.' }
    New-Item -ItemType Directory -Path (Split-Path $ArchivePath -Parent) -Force | Out-Null
    $zip = [IO.Compression.ZipFile]::Open($ArchivePath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($entry in $files.GetEnumerator()) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,
                (Join-Path $repo $entry.Value), $entry.Key, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally { $zip.Dispose() }
    Test-Archive $ArchivePath
    "PASS: MODIFIED release ZIP contains exactly $($files.Count) files; hashes match baseline; no development files"
    exit 0
}

Test-Archive $ArchivePath
"PASS: VERIFIED $($files.Count) archive entries; hashes match source; relative install path; license retained"
