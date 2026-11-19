$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronDist = Join-Path $project 'node_modules\electron\dist'
$release = Join-Path $project 'release'
$portable = Join-Path $release 'MobiDesk-Portable'
$targetExe = Join-Path $portable 'MobiDesk.exe'

if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
  throw 'Electron is not installed. Run npm install in the project folder first.'
}
$null = New-Item -ItemType Directory -Force -Path $release
if (Test-Path -LiteralPath $portable) {
  $releaseRoot = (Resolve-Path -LiteralPath $release).Path
  $oldTarget = (Resolve-Path -LiteralPath $portable).Path
  if (-not $oldTarget.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a folder outside release: $oldTarget"
  }
  Remove-Item -LiteralPath $oldTarget -Recurse -Force
}
$null = New-Item -ItemType Directory -Force -Path (Join-Path $portable 'resources\app')
$null = New-Item -ItemType Directory -Force -Path (Join-Path $portable 'resources\tools')
Copy-Item -Path (Join-Path $electronDist '*') -Destination $portable -Recurse -Force
Copy-Item -Path (Join-Path $project 'main.js'),(Join-Path $project 'preload.js'),(Join-Path $project 'package.json') -Destination (Join-Path $portable 'resources\app') -Force
Copy-Item -Path (Join-Path $project 'renderer') -Destination (Join-Path $portable 'resources\app') -Recurse -Force
Copy-Item -Path (Join-Path $project 'assets') -Destination (Join-Path $portable 'resources\app') -Recurse -Force
Copy-Item -Path (Join-Path $project 'tools\*') -Destination (Join-Path $portable 'resources\tools') -Recurse -Force
Move-Item -LiteralPath (Join-Path $portable 'electron.exe') -Destination $targetExe -Force
$iconEditor = Join-Path $project 'node_modules\electron-winstaller\vendor\rcedit.exe'
$appIcon = Join-Path $project 'assets\mobidesk.ico'
if (-not (Test-Path $iconEditor)) { throw 'Could not find the Windows icon editor needed to brand the portable app.' }
& $iconEditor $targetExe --set-icon $appIcon
if ($LASTEXITCODE -ne 0) { throw 'Could not apply the MobiDesk app icon to the Windows executable.' }
Copy-Item -LiteralPath (Join-Path $project 'README.md') -Destination (Join-Path $portable 'README-MobiDesk.txt') -Force

$zip = Join-Path $release 'MobiDesk-Windows-Bundle.zip'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path $portable -DestinationPath $zip -CompressionLevel Optimal
Write-Output "Portable Windows bundle created: $zip"
