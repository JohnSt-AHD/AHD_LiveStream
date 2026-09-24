# Build a Play Store upload AAB (Capacitor → bundleRelease).
# Requires: JDK 17–21, Android SDK, and apps/regatta-nz-native/keystore/ (gitignored).
$ErrorActionPreference = "Stop"

function Test-JavaHome([string]$javaHome) {
  if ([string]::IsNullOrWhiteSpace($javaHome)) { return $false }
  $java = Join-Path $javaHome.TrimEnd('\') "bin\java.exe"
  return Test-Path $java
}

function Resolve-JavaHome {
  param([string]$Preferred)

  if (Test-JavaHome $Preferred) { return $Preferred.TrimEnd('\') }

  $searchRoots = @(
    "$env:ProgramFiles\Microsoft\jdk*",
    "$env:ProgramFiles\Eclipse Adoptium\jdk*",
    "$env:ProgramFiles\Java\jdk*",
    "$env:ProgramFiles\Android\Android Studio\jbr",
    "$env:LOCALAPPDATA\Programs\Eclipse Adoptium\jdk*",
    "$env:LOCALAPPDATA\Programs\Android\Android Studio\jbr"
  )

  $found = [System.Collections.Generic.List[string]]::new()
  foreach ($pattern in $searchRoots) {
    Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | ForEach-Object {
      if (Test-JavaHome $_.FullName) { [void]$found.Add($_.FullName) }
    }
  }

  if ($found.Count -eq 0) { return $null }

  # Prefer JDK 17–21 for Android Gradle Plugin; skip newer majors (e.g. 25).
  $preferred = $found | Where-Object {
    $n = Split-Path $_ -Leaf
    $n -match 'jdk-?(1[7-9]|2[0-1])' -or $n -eq 'jbr'
  } | Sort-Object Name -Descending | Select-Object -First 1
  if ($preferred) { return $preferred }

  return ($found | Sort-Object Name -Descending | Select-Object -First 1)
}

$resolvedJavaHome = Resolve-JavaHome $env:JAVA_HOME
if (-not $resolvedJavaHome) {
  Write-Host "No JDK found. Install JDK 17–21 or Android Studio, or set JAVA_HOME." -ForegroundColor Red
  exit 1
}
if ($env:JAVA_HOME -ne $resolvedJavaHome) {
  Write-Host "Using JAVA_HOME: $resolvedJavaHome" -ForegroundColor Yellow
  $env:JAVA_HOME = $resolvedJavaHome
}

# Prefer $PSScriptRoot (stable); fall back for unusual hosts.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$nativeRoot = Split-Path -Parent $scriptDir
$keystoreProps = Join-Path $nativeRoot "keystore\keystore.properties"
$outAab = Join-Path $nativeRoot "install\Regatta-NZ-release.aab"

if (-not (Test-Path $keystoreProps)) {
  Write-Host "Missing release keystore config: $keystoreProps" -ForegroundColor Red
  Write-Host "Create keystore/ first (see keystore/README-BACKUP.txt after generation)." -ForegroundColor Red
  exit 1
}

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path $sdk) {
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    Write-Host "Using ANDROID_HOME: $sdk" -ForegroundColor Yellow
  }
}

Write-Host "==> Capacitor sync android..." -ForegroundColor Cyan
Set-Location $nativeRoot
npx cap sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$androidDir = Join-Path $nativeRoot "android"
if (-not (Test-Path (Join-Path $androidDir "gradlew.bat"))) {
  Write-Host 'Android project missing. Run: cd apps/regatta-nz-native; npx cap add android' -ForegroundColor Red
  exit 1
}

$localProps = Join-Path $androidDir "local.properties"
if (-not (Test-Path $localProps) -and $env:ANDROID_HOME) {
  $sdkEscaped = ($env:ANDROID_HOME -replace '\\', '\\')
  Set-Content -Path $localProps -Value "sdk.dir=$sdkEscaped" -Encoding ASCII
}

Write-Host "==> Gradle bundleRelease (first run may take several minutes)..." -ForegroundColor Cyan
Set-Location $androidDir
$env:JAVA_HOME = $resolvedJavaHome
& .\gradlew.bat bundleRelease "-Dorg.gradle.java.home=$resolvedJavaHome" "-Dorg.gradle.java.installations.auto-download=false"
$gradleExit = $LASTEXITCODE
if ($gradleExit -ne 0) {
  Write-Host "Gradle failed. Check signing (keystore/) and ANDROID_HOME / JDK 17–21." -ForegroundColor Red
  exit $gradleExit
}

# Recompute after gradlew — some hosts clobber script variables during the bat call.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$nativeRoot = Split-Path -Parent $scriptDir
$androidDir = Join-Path $nativeRoot "android"
$installDir = Join-Path $nativeRoot "install"
$outAab = Join-Path $installDir "Regatta-NZ-release.aab"
$bundleDir = Join-Path $androidDir "app\build\outputs\bundle\release"
$built = Join-Path $bundleDir "app-release.aab"
if (-not (Test-Path $built)) {
  $found = Get-ChildItem $bundleDir -Filter "*.aab" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($found) { $built = $found.FullName }
}
if (-not (Test-Path $built)) {
  Write-Host "AAB not found under $bundleDir" -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item $built $outAab -Force

Write-Host ""
Write-Host "AAB ready (upload this in Play Console):" -ForegroundColor Green
Write-Host "  $outAab"
Write-Host ""
Write-Host "Gradle output also at:" -ForegroundColor DarkGray
Write-Host "  $built"
Write-Host ""

if (Get-Command explorer -ErrorAction SilentlyContinue) {
  explorer $installDir
}
