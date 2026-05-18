# Convert Milford ProRes 4444 .mov sources to VP9 WebM with alpha for vMix overlays.
# Requires ffmpeg (winget install Gyan.FFmpeg).

$ErrorActionPreference = 'Stop'
$bin = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $bin) { throw 'ffmpeg not found. Install with: winget install Gyan.FFmpeg' }

$root = Split-Path $PSScriptRoot -Parent

$jobs = @(
    @{ i = 'Milford_Tracker.mov';       o = 'public/assets/vmix/milford/tracker.webm' },
    @{ i = 'Milfod_LT.mov';             o = 'public/assets/vmix/milford/lower.webm' },
    @{ i = 'Milford_Draw_25.mov';      o = 'public/assets/vmix/milford/draw.webm' },
    @{ i = 'Milford_Leader.mov';       o = 'public/assets/vmix/milford/leader.webm' },
    @{ i = 'Milford_Result_Heats.mov'; o = 'public/assets/vmix/milford/results.webm' },
    @{ i = 'BeachSprints_DRAW.mov';    o = 'public/assets/vmix/beachsprints/draw.webm' },
    @{ i = 'BeachSprints_LR.mov';      o = 'public/assets/vmix/beachsprints/lower.webm' }
)

foreach ($j in $jobs) {
    $in = Join-Path $root "Milford\$($j.i)"
    $out = Join-Path $root $j.o
    $dir = Split-Path $out -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Write-Host "Converting $($j.i) -> $($j.o)"
    & $bin -y -i $in -an -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -crf 30 -b:v 0 -row-mt 1 -threads 0 $out
}

Write-Host 'Done.'
