param(
    [string] $ModDirectory = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Paradox Interactive/Europa Universalis IV/mod')
)

$ErrorActionPreference = 'Stop'
# Preserve the existing sync entry point; the shared implementation is shell/Node.
& sh (Join-Path $PSScriptRoot 'Sync-ReduxMods.sh') $ModDirectory
if ($LASTEXITCODE -ne 0) { throw "Redux synchronization failed with exit code $LASTEXITCODE" }
