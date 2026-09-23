# Build a sideloadable Regatta NZ APK (Capacitor → assembleDebug).
# Requires: JDK 17+ and Android SDK.
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
  Write-Host "No JDK found. Install JDK 17+ or Android Studio, or set JAVA_HOME." -ForegroundColor Red
  exit 1
}
if ($env:JAVA_HOME -ne $resolvedJavaHome) {
  Write-Host "Using JAVA_HOME: $resolvedJavaHome" -ForegroundColor Yellow
  $env:JAVA_HOME = $resolvedJavaHome
}

$native = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$android = Join-Path $native "android"
$installDir = Join-Path $native "install"
$outApk = Join-Path $installDir "Regatta-NZ.apk"

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path $sdk) {
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    Write-Host "Using ANDROID_HOME: $sdk" -ForegroundColor Yellow
  }
}

Write-Host "==> Capacitor sync android..." -ForegroundColor Cyan
Push-Location $native
npx cap sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path (Join-Path $android "gradlew.bat"))) {
  Write-Host "Android project missing. Run: cd apps/regatta-nz-native && npx cap add android" -ForegroundColor Red
  exit 1
}

$localProps = Join-Path $android "local.properties"
if (-not (Test-Path $localProps) -and $env:ANDROID_HOME) {
  $sdkEscaped = ($env:ANDROID_HOME -replace '\\', '\\')
  Set-Content -Path $localProps -Value "sdk.dir=$sdkEscaped" -Encoding ASCII
}

Write-Host "==> Gradle assembleDebug (first run may take several minutes)..." -ForegroundColor Cyan
Push-Location $android
$gradleHomeArg = "-Dorg.gradle.java.home=$resolvedJavaHome"
.\gradlew.bat assembleDebug $gradleHomeArg "-Dorg.gradle.java.installations.auto-download=false"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Gradle failed. Install Android Studio and open the project once, or set ANDROID_HOME." -ForegroundColor Red
  exit $LASTEXITCODE
}

$debugDir = Join-Path $android "app\build\outputs\apk\debug"
$built = Join-Path $debugDir "app-arm64-v8a-debug.apk"
if (-not (Test-Path $built)) {
  $built = Join-Path $debugDir "app-debug.apk"
}
if (-not (Test-Path $built)) {
  $split = Get-ChildItem $debugDir -Filter "app-*-debug.apk" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($split) { $built = $split.FullName }
}
if (-not (Test-Path $built)) {
  Write-Host "APK not found under $debugDir" -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item $built $outApk -Force

Write-Host ""
Write-Host "APK ready:" -ForegroundColor Green
Write-Host "  $outApk"
Write-Host ""
Write-Host "Install: copy to phone → open APK → allow unknown apps if prompted." -ForegroundColor Yellow
Write-Host ""

if (Get-Command explorer -ErrorAction SilentlyContinue) {
  explorer $installDir
}

Pop-Location
Pop-Location
