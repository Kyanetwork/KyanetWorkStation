Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$rootDir = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath ".."))
Push-Location $rootDir
try {
  node scripts/backup-db.js
}
finally {
  Pop-Location
}
