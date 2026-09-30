param(
    [Parameter(Mandatory)] [ValidateSet('Baseline', 'Modified', 'Rollback')] [string] $Mode,
    [Parameter(Mandatory)] [string] $ModDirectory,
    [string] $BackupDirectory
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$modDirectory = [IO.Path]::GetFullPath($ModDirectory)
$meiouPath = Join-Path $modDirectory 'MEIOUandTaxes1/interface/provinceview.gui'
$basePath = Join-Path $modDirectory 'Pop Display/interface/provinceview.gui'
$target = Join-Path $modDirectory 'redux-tweak'
$launcher = Join-Path $modDirectory 'redux-tweak.mod'

function Assert-Condition([bool] $condition, [string] $message) {
    if (-not $condition) { throw $message }
}

Assert-Condition (Test-Path -LiteralPath $meiouPath -PathType Leaf) 'MEIOU GUI is missing'
Assert-Condition ((Get-FileHash -LiteralPath $meiouPath -Algorithm SHA256).Hash -ceq
    '2CFCC89956B89BA4948F902A6152BA232241119B654FDB1CD74AFBFCCCDB1214') 'MEIOU GUI changed'
Assert-Condition (Test-Path -LiteralPath $basePath -PathType Leaf) 'Pop Display GUI is missing'
Assert-Condition ((Get-FileHash -LiteralPath $basePath -Algorithm SHA256).Hash -ceq
    '4EEA36E04375D2CAC1F7CB44E9E7367F99B1D439117098CC5661320258634788') 'Pop Display GUI changed'
$base = [Text.Encoding]::Latin1.GetString([IO.File]::ReadAllBytes($basePath))
Assert-Condition (([regex]::Matches($base, 'name = "(prod|mp)_base_increase_button"')).Count -eq 2) 'native pin buttons changed'
Assert-Condition (-not $base.Contains('redux_subject_select_')) 'base GUI contains Redux buttons'
Assert-Condition ($base.Contains('name = "unpin_everything"') -and
    $base.Contains('name = "select_area"')) 'Pop Display controls missing from base GUI'

if ($Mode -eq 'Baseline' -or $Mode -eq 'Rollback') {
    Assert-Condition (-not (Test-Path -LiteralPath $target) -and -not (Test-Path -LiteralPath $launcher)) 'Redux files remain installed'
    if ($Mode -eq 'Rollback') {
        Assert-Condition (Test-Path -LiteralPath (Join-Path $BackupDirectory 'redux-tweak/interface/provinceview.gui') -PathType Leaf) 'backup GUI missing'
        Assert-Condition (Test-Path -LiteralPath (Join-Path $BackupDirectory 'redux-tweak.mod') -PathType Leaf) 'backup launcher missing'
        'PASS: ROLLBACK Redux removed; Pop Display and MEIOU GUIs unchanged; backup retained'
    } else {
        'PASS: BASELINE Pop Display controls present; subject overlays=0; Redux absent'
    }
    exit 0
}

$files = @(
    'descriptor.mod',
    'common/scripted_effects/SYS-Construct.txt',
    'common/custom_gui/ReduxSubjectSelection.txt',
    'localisation/redux-tweak_l_english.yml',
    'decisions/ReduxSubjectSelection.txt',
    'customizable_localization/ReduxSubjectSelection.txt',
    'common/scripted_triggers/ReduxSubjectSelection.txt',
    'common/scripted_effects/ReduxSubjectSelection.txt',
    'common/scripted_effects/SYS-Prov.txt',
    'common/on_actions/00_on_actions.txt'
)
foreach ($relative in $files) {
    $sourceFile = Join-Path (Join-Path $repo 'redux-tweak') $relative
    $installedFile = Join-Path $target $relative
    Assert-Condition (Test-Path -LiteralPath $installedFile -PathType Leaf) "missing $relative"
    Assert-Condition ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash -ceq
        (Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash) "hash differs: $relative"
}
$guiPath = Join-Path $target 'interface/provinceview.gui'
Assert-Condition ((Get-FileHash -LiteralPath $guiPath -Algorithm SHA256).Hash -ceq
    '697DF7DFD78B3B2266060730DCD0D3DDCCC17FCF22F45B89482E6CCDF81D2058') 'installed GUI differs from the Pop Display-based two-pin overlay'
$gui = [Text.Encoding]::Latin1.GetString([IO.File]::ReadAllBytes($guiPath))
Assert-Condition ($gui.Contains('name = "unpin_everything"') -and
    $gui.Contains('name = "select_area"')) 'Pop Display controls were lost in the override'
Assert-Condition ($gui.Contains("name = `"province_window`"`n      backGround = `"`"`n      position = {`n        x = 0`n        y = -374`n      }`n      size = {`n        x = 550`n")) 'province window does not contain subject pin hitboxes'
Assert-Condition (([regex]::Matches($gui, 'name = "(prod|mp)_base_increase_button"')).Count -eq 2) 'owned-province native buttons changed'
foreach ($name in @('redux_subject_select_dip', 'redux_subject_select_mil')) {
    Assert-Condition (([regex]::Matches($gui, "name = `"$name`"")).Count -eq 1) "GUI button missing or duplicated: $name"
}
Assert-Condition (-not $gui.Contains('name = "redux_subject_select"')) 'obsolete building-list overlay remains'
$button = [IO.File]::ReadAllText((Join-Path $target 'common/custom_gui/ReduxSubjectSelection.txt'))
Assert-Condition (([regex]::Matches($button, 'is_subject_of = FROM')).Count -eq 2 -and
    ([regex]::Matches($button, 'is_subject_other_than_tributary_trigger = yes')).Count -eq 2 -and
    ([regex]::Matches($button, 'Pow_UI_R = yes')).Count -eq 2 -and
    ([regex]::Matches($button, 'Pow_UI = yes')).Count -eq 2 -and
    ([regex]::Matches($button, 'has_province_flag = Pin_Show')).Count -eq 2 -and
    ([regex]::Matches($button, 'tooltip = redux_subject_select_tooltip')).Count -eq 2) 'subject scope or pin toggle differs'
$locale = [IO.File]::ReadAllBytes((Join-Path $target 'localisation/redux-tweak_l_english.yml'))
Assert-Condition ($locale.Length -gt 3 -and $locale[0] -eq 0xef -and $locale[1] -eq 0xbb -and $locale[2] -eq 0xbf) 'EU4 tooltip localisation BOM missing'
$descriptor = [IO.File]::ReadAllText($launcher)
$expectedPath = (Join-Path $modDirectory 'redux-tweak').Replace('\', '/')
Assert-Condition ($descriptor.Contains("path=`"$expectedPath`"") -and
    $descriptor.Contains('"MEIOU and Taxes v3.0"') -and
    $descriptor.Contains('"Pop Display"')) 'launcher path or dependencies differ'
Assert-Condition (([IO.File]::ReadAllText((Join-Path $target 'descriptor.mod'))).Contains('"Pop Display"')) 'inner descriptor lacks Pop Display dependency'

'PASS: MODIFIED Pop Display controls preserved; subject overlays=2; dependencies=2; twelve files verified'
