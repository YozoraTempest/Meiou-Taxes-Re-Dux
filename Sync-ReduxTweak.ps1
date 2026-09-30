param(
    [string] $ModDirectory = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Paradox Interactive/Europa Universalis IV/mod')
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$modDirectory = [IO.Path]::GetFullPath($ModDirectory)
$baseGuiPath = Join-Path $modDirectory 'Pop Display/interface/provinceview.gui'
$target = Join-Path $modDirectory 'redux-tweak'
$baseGuiHash = '4EEA36E04375D2CAC1F7CB44E9E7367F99B1D439117098CC5661320258634788'

foreach ($baseFile in @(
    @{ Path = 'common/on_actions/00_on_actions.txt'; Hash = 'CF512DD7F6FF8C52583374D811ACA1764DF62DF56C6A11611E027D69520A026A' },
    @{ Path = 'common/scripted_effects/SYS-Prov.txt'; Hash = '85B7EE4A862041F99B524C04FC13D87FFB50B4CCA8F6BA71E873CF7BF254C8CC' }
)) {
    $path = Join-Path $modDirectory ('MEIOUandTaxes1/' + $baseFile.Path)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $baseFile.Hash) {
        throw "Installed MEIOU selection baseline differs: $($baseFile.Path)"
    }
}

if (-not (Test-Path -LiteralPath $baseGuiPath -PathType Leaf)) {
    throw "Installed Pop Display GUI not found: $baseGuiPath"
}
if ((Get-FileHash -LiteralPath $baseGuiPath -Algorithm SHA256).Hash -cne $baseGuiHash) {
    throw 'Installed Pop Display GUI changed; rebase the province pin overlay before syncing.'
}
$popDescriptorPath = Join-Path $modDirectory 'Pop Display.mod'
if (-not (Test-Path -LiteralPath $popDescriptorPath -PathType Leaf) -or
    -not ([IO.File]::ReadAllText($popDescriptorPath)).Contains('name="Pop Display"')) {
    throw 'Installed Pop Display descriptor is missing or has a different mod name.'
}

$baseGui = [Text.Encoding]::Latin1.GetString([IO.File]::ReadAllBytes($baseGuiPath))
$deployedGui = $baseGui
$windowWidth = "      name = `"province_window`"`n      backGround = `"`"`n      position = {`n        x = 0`n        y = -374`n      }`n      size = {`n        x = 475`n"
if ($deployedGui.Split(@($windowWidth), [StringSplitOptions]::None).Count -ne 2) {
    throw 'Province window width anchor was not found exactly once.'
}
$deployedGui = $deployedGui.Replace($windowWidth, $windowWidth.Replace('x = 475', 'x = 550'))
foreach ($pin in @(
    @{ Native = 'prod_base_increase_button'; Next = 'prod_base_exploit_button'; Name = 'redux_subject_select_dip'; Y = 157; Sprite = 'GFX_actions_button_mod_1' },
    @{ Native = 'mp_base_increase_button'; Next = 'mp_base_exploit_button'; Name = 'redux_subject_select_mil'; Y = 184; Sprite = 'GFX_actions_button_mod_2' }
)) {
    $anchor = "      guiButtonType = {`n        name = `"$($pin.Next)`""
    if ($deployedGui.Split(@($anchor), [StringSplitOptions]::None).Count -ne 2) {
        throw "Province pin anchor was not found exactly once: $($pin.Next)"
    }
    $preceding = $deployedGui.Substring(0, $deployedGui.IndexOf($anchor))
    if (-not $preceding.EndsWith("        shortcut = `"d`"`n      }`n") -or
        -not $preceding.Contains("name = `"$($pin.Native)`"")) {
        throw "Native province pin no longer precedes $($pin.Next)"
    }
    $overlay = @(
        '      guiButtonType = {',
        "        name = `"$($pin.Name)`"",
        '        scripted = yes',
        '        position = {',
        '          x = 490',
        "          y = $($pin.Y)",
        '        }',
        "        quadTextureSprite = `"$($pin.Sprite)`"",
        '        Orientation = "UPPER_LEFT"',
        '      }'
    ) -join "`n"
    $deployedGui = $deployedGui.Replace($anchor, "$overlay`n$anchor")
}
$sourceGuiPath = Join-Path $source 'redux-tweak/interface/provinceview.gui'
if ([Text.Encoding]::Latin1.GetString([IO.File]::ReadAllBytes($sourceGuiPath)) -cne $deployedGui) {
    throw 'Repository province GUI differs from the Pop Display-based generated overlay.'
}

$descriptor = [IO.File]::ReadAllText((Join-Path $source 'redux-tweak.mod'))
$descriptorPath = (Join-Path $modDirectory 'redux-tweak').Replace('\', '/')
if ($descriptorPath.Contains('"') -or ([regex]::Matches($descriptor, '(?m)^path="mod/redux-tweak"$')).Count -ne 1) {
    throw 'Launcher descriptor path is not unique or contains an unsupported quote.'
}
$descriptor = [regex]::Replace($descriptor, '(?m)^path="mod/redux-tweak"$',
    [System.Text.RegularExpressions.MatchEvaluator] { param($match) "path=`"$descriptorPath`"" })

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
$knownInstalledHashes = @{
    'descriptor.mod' = @(
        '319E7FFD8EA39D9EF5CBECFD07471EDEA8A9087C10B706D5BCAAC2BC83994BC2',
        'C7AF00B74B1A724A3486954C73EF81CA83431E49494F17E6500FB1905EC3611F',
        'C4943ED21F77F3873BF7B8E81ED39640E5BD2BE838CF41D7E0193DF283B37ACB',
        (Get-FileHash -LiteralPath (Join-Path $source 'redux-tweak/descriptor.mod') -Algorithm SHA256).Hash
    )
    'common/scripted_effects/SYS-Construct.txt' = @('F179ED5E26FB1469D5D57AC173313261295F35A9A94F772F21C13A597F002CA3')
    'common/custom_gui/ReduxSubjectSelection.txt' = @(
        '7A81F4AB491D080F23A4FABB193AF41D89F0E25AD8FB9FB29BC6C580513E37DB',
        '02333ACADA886F0266441D06717236578DC388A842D84979BEE73CCB2B14D0B5',
        '18598E2EF0C351D4C8A0A720B4A7263F7E24E901DFF3946DEC2F1451D3361B00'
    )
    'interface/provinceview.gui' = @(
        'C9D5C1767F3AEAE10BCEFE59D37CD37706CF9540322BC599747673A128EB98A8',
        '664A4E52F86F20A3A44E2D105F4E57D6D450E8F25D0CA3F8070D466D7EB196D0',
        '2E2AD78C895AF291656593C93B48A092D182EDA61B14C450B53E475D4B859BF5',
        '697DF7DFD78B3B2266060730DCD0D3DDCCC17FCF22F45B89482E6CCDF81D2058'
    )
    'common/scripted_effects/ReduxSubjectSelection.txt' = @('0148F9E770BA93064CDF3902343D3E44CBDACD02EFE9E56CABA9B97887B04D25')
    'common/scripted_triggers/ReduxSubjectSelection.txt' = @('BA1A8ADFB3EF2462E0E07D53EA08A10239BAB1CF569EDB4ACBC7207B917FA9D7')
}
foreach ($relative in $files | Where-Object { $_ -notin @('descriptor.mod', 'localisation/redux-tweak_l_english.yml') }) {
    $currentHash = (Get-FileHash -LiteralPath (Join-Path $source ('redux-tweak/' + $relative)) -Algorithm SHA256).Hash
    $knownInstalledHashes[$relative] = @($knownInstalledHashes[$relative]) + @($currentHash)
}
foreach ($relative in $knownInstalledHashes.Keys) {
    $installedFile = Join-Path $target $relative
    if ((Test-Path -LiteralPath $installedFile -PathType Leaf) -and
        (Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash -cnotin $knownInstalledHashes[$relative]) {
        throw "Previously installed Redux Tweak file was modified: $relative"
    }
}
$oldLocale = Join-Path $target 'localisation/redux-tweak_l_english.yml'
if (Test-Path -LiteralPath $oldLocale -PathType Leaf) {
    $knownLocaleHashes = @(
        '463539FF656ECF4AD5915841CFF0A762A6DE4BA7F3EE3310EFA898DADE5008DF',
        'EA500C241E9FEA083151FA7FA15F2FF217E6BB137C5816E5B2F3D57048E9F17F',
        '5A25602585D6F5309CCE7AAC3C7F38F6E2741E2F41983AA94BFB370EDF1DB8D1',
        (Get-FileHash -LiteralPath (Join-Path $source 'redux-tweak/localisation/redux-tweak_l_english.yml') -Algorithm SHA256).Hash
    )
    if ((Get-FileHash -LiteralPath $oldLocale -Algorithm SHA256).Hash -cnotin $knownLocaleHashes) {
        throw 'Previously installed Redux Tweak localisation was modified; inspect it before syncing.'
    }
}
$launcherDescriptor = Join-Path $modDirectory 'redux-tweak.mod'
if (Test-Path -LiteralPath $launcherDescriptor -PathType Leaf) {
    $existingDescriptor = [IO.File]::ReadAllText($launcherDescriptor)
    $pathLine = "path=`"$descriptorPath`""
    if (([regex]::Matches($existingDescriptor, '(?m)^path="[^"]+"$')).Count -ne 1 -or
        -not $existingDescriptor.Contains($pathLine) -or
        -not $existingDescriptor.Contains('name="Redux Tweak"') -or
        -not $existingDescriptor.Contains('"MEIOU and Taxes v3.0"')) {
        throw 'Existing launcher descriptor differs; inspect it before syncing.'
    }
    $dependencyBlock = [regex]::Match($existingDescriptor, '(?ms)^dependencies=\{(?<entries>.*?)^\}')
    if (-not $dependencyBlock.Success -or
        ([regex]::Matches($existingDescriptor, '(?m)^dependencies=\{')).Count -ne 1) {
        throw 'Existing launcher dependency block is missing or duplicated.'
    }
    $dependencyNames = @([regex]::Matches($dependencyBlock.Groups['entries'].Value, '"([^"]+)"') |
        ForEach-Object { $_.Groups[1].Value })
    if ($dependencyNames.Count -lt 1 -or $dependencyNames.Count -gt 2 -or
        $dependencyNames -cnotcontains 'MEIOU and Taxes v3.0' -or
        ($dependencyNames.Count -eq 2 -and $dependencyNames -cnotcontains 'Pop Display')) {
        throw 'Existing launcher dependencies differ; inspect them before syncing.'
    }
    if ($dependencyNames -cnotcontains 'Pop Display') {
        $lineEnding = if ($existingDescriptor.Contains("`r`n")) { "`r`n" } else { "`n" }
        $newBlock = 'dependencies={' + $lineEnding + "`t`"MEIOU and Taxes v3.0`"" +
            $lineEnding + "`t`"Pop Display`"" + $lineEnding + '}'
        $existingDescriptor = $existingDescriptor.Replace($dependencyBlock.Value, $newBlock)
    }
    $descriptor = $existingDescriptor
    $sourceVersion = [regex]::Match([IO.File]::ReadAllText((Join-Path $source 'redux-tweak.mod')), '(?m)^version="([^"]+)"').Groups[1].Value
    if (([regex]::Matches($descriptor, '(?m)^version="[^"]+"')).Count -ne 1) {
        throw 'Existing launcher version is missing or duplicated.'
    }
    $descriptor = [regex]::Replace($descriptor, '(?m)^version="[^"]+"', "version=`"$sourceVersion`"")
}
foreach ($relative in $files) {
    $sourceFile = Join-Path (Join-Path $source 'redux-tweak') $relative
    $destination = Join-Path $target $relative
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $destination -Force
}

$guiDestination = Join-Path $target 'interface/provinceview.gui'
New-Item -ItemType Directory -Path (Split-Path $guiDestination -Parent) -Force | Out-Null
[IO.File]::WriteAllBytes($guiDestination, [Text.Encoding]::Latin1.GetBytes($deployedGui))
if (-not (Test-Path -LiteralPath $launcherDescriptor -PathType Leaf) -or
    [IO.File]::ReadAllText($launcherDescriptor) -cne $descriptor) {
    [IO.File]::WriteAllText($launcherDescriptor, $descriptor, [Text.UTF8Encoding]::new($false))
}
foreach ($relative in $files) {
    $sourceHash = (Get-FileHash -LiteralPath (Join-Path (Join-Path $source 'redux-tweak') $relative) -Algorithm SHA256).Hash
    $installedHash = (Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash
    if ($sourceHash -cne $installedHash) { throw "Installed file differs: $relative" }
}
if ([Text.Encoding]::Latin1.GetString([IO.File]::ReadAllBytes($guiDestination)) -cne $deployedGui -or
    [IO.File]::ReadAllText($launcherDescriptor) -cne $descriptor) {
    throw 'Installed GUI or launcher descriptor differs from generated content.'
}

"SYNC PASS: $($files.Count + 2) files verified in $modDirectory"
