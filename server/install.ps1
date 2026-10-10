#Requires -RunAsAdministrator
<#
  ExportDesk - Windows installer for the BACKEND ONLY. The frontend lives on Vercel.
  Works in two layouts:
    - EXE layout   : ExportDesk-server.exe + .env  (no Node.js, no node_modules needed)
    - Source layout: index.js + routes\ + package.json + .env (+ node_modules\)

  Run from an elevated PowerShell (Run as Administrator) inside the copied folder:

      Set-ExecutionPolicy -Scope Process Bypass -Force
      cd C:\ExportDesk
      Set-ExecutionPolicy -Scope Process Bypass -Force
      .\install.ps1                                 # LAN / public-IP mode  ->  http://<pc-ip>:4000
      .\install.ps1 -Domain api.yourdomain.com      # public HTTPS via Caddy (DNS A record -> this PC, ports 80/443 open)
      .\install.ps1 -Port 4100                      # use another port if 4000 is taken

  What it does
    1. copies this folder to C:\ExportDesk (index.js, routes\, .env, node_modules\ ...)
    2. installs Node.js LTS if missing, then the dependencies (skipped when node_modules is included)
    3. opens the firewall port(s)
    4. registers a scheduled task "ExportDeskAPI" that starts at boot and restarts the backend if it stops
    5. with -Domain: downloads caddy.exe and registers "ExportDeskCaddy" for automatic HTTPS
  Safe to run again: it updates the files and restarts only its own processes.
  Settings live in .env next to this script (REGISTRY_* for multi-client mode, PLATFORM_ADMIN_*, PORT).
#>
param(
  [string]$InstallPath = "C:\ExportDesk",
  [string]$Domain = "",
  [int]$Port = 4000
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverJs = Join-Path $InstallPath "index.js"
$exe = Join-Path $InstallPath "ExportDesk-server.exe"
$useExe = Test-Path (Join-Path $src "ExportDesk-server.exe")
$runner = Join-Path $InstallPath "run-server.cmd"
$log = Join-Path $InstallPath "server.log"
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

function Stop-OurProcesses {
  Stop-ScheduledTask -TaskName "ExportDeskAPI" -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName "ExportDeskCaddy" -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -eq "cmd.exe"   -and $_.CommandLine -like "*$runner*") -or
    ($_.Name -eq "node.exe"  -and $_.CommandLine -like "*$serverJs*") -or
    ($_.Name -eq "ExportDesk-server.exe" -and $_.ExecutablePath -eq $exe) -or
    ($_.Name -eq "caddy.exe" -and $_.ExecutablePath -eq (Join-Path $InstallPath "caddy.exe"))
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# ---------- 1. files ----------
Step "Copying files to $InstallPath"
Stop-OurProcesses
New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
if ((Resolve-Path $src).Path.TrimEnd('\') -ne (Resolve-Path $InstallPath).Path.TrimEnd('\')) {
  # node_modules is copied too when present (pure-JavaScript dependencies: no internet needed on the PC)
  & robocopy $src $InstallPath /E /XD .git .vercel config /XF *.zip *.log /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "File copy failed (robocopy exit code $LASTEXITCODE)" }
}
$envFile = Join-Path $InstallPath ".env"
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $InstallPath ".env.example") $envFile; Write-Warning ".env was missing - created from .env.example. Fill in REGISTRY_* / PLATFORM_ADMIN_* in $envFile and run again."; exit 1 }

function Set-EnvValue($key, $value) {
  $lines = @(Get-Content $envFile)
  if ($lines -match "^$key=") { $lines = $lines -replace "^$key=.*", "$key=$value" } else { $lines += "$key=$value" }
  Set-Content -Path $envFile -Value $lines -Encoding ASCII
}
Set-EnvValue "PORT" $Port
Set-EnvValue "HOST" $(if ($Domain) { "127.0.0.1" } else { "0.0.0.0" })
Set-EnvValue "COOKIE_SECURE" $(if ($Domain) { "1" } else { "0" })


# ---------- port check ----------
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($busy.OwningProcess)" -ErrorAction SilentlyContinue
  throw "Port $Port is already used by '$($owner.Name)' (PID $($busy.OwningProcess)). Run again with another port, e.g.  .\install.ps1 -Port 4100"
}

# ---------- 2. Node.js (source layout only) ----------
$nodeExe = $null
if ($useExe) {
  Step "Single-file backend: $exe (Node.js not required)"
} else {
Step "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js not found - installing Node.js 20 LTS..."
  $msi = Join-Path $env:TEMP "node-lts.msi"
  Invoke-WebRequest "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi" -OutFile $msi -UseBasicParsing
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "Node.js installer failed (exit code $($p.ExitCode))" }
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js was installed but is not on PATH yet. Open a new Administrator PowerShell and run the script again." }
}
$nodeExe = $node.Source
Write-Host "Node $(& $nodeExe -v)  ($nodeExe)"

Step "Dependencies"
if (Test-Path (Join-Path $InstallPath "node_modules\mssql")) {
  Write-Host "node_modules already present - skipping npm install (no internet needed)"
} else {
  Push-Location $InstallPath
  try {
    & npm install --omit=dev --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit code $LASTEXITCODE)" }
  } finally { Pop-Location }
}
}

# ---------- 3. firewall ----------
Step "Windows Firewall"
$ports = if ($Domain) { @(80, 443) } else { @($Port) }
Get-NetFirewallRule -DisplayName "ExportDesk (*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
foreach ($p in $ports) {
  New-NetFirewallRule -DisplayName "ExportDesk ($p)" -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow -Profile Any | Out-Null
  Write-Host "Inbound TCP $p allowed"
}

# ---------- 4. backend task ----------
Step "Registering backend task 'ExportDeskAPI'"
$startCmd = if ($useExe) { "`"$exe`"" } else { "`"$nodeExe`" `"$serverJs`"" }
Set-Content -Path $runner -Encoding ASCII -Value @"
@echo off
cd /d "$InstallPath"
:loop
echo [%date% %time%] starting backend >> "$log"
$startCmd >> "$log" 2>&1
echo [%date% %time%] backend stopped (exit %errorlevel%), restarting in 5 s >> "$log"
timeout /t 5 /nobreak > nul
goto loop
"@
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$action   = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$runner`"" -WorkingDirectory $InstallPath
Register-ScheduledTask -TaskName "ExportDeskAPI" -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName "ExportDeskAPI"

# ---------- 5. optional HTTPS with Caddy ----------
if ($Domain) {
  Step "Caddy - automatic HTTPS for https://$Domain"
  $caddy = Join-Path $InstallPath "caddy.exe"
  if (-not (Test-Path $caddy)) {
    Invoke-WebRequest "https://caddyserver.com/api/download?os=windows&arch=amd64" -OutFile $caddy -UseBasicParsing
  }
  $caddyfile = Join-Path $InstallPath "Caddyfile"
  Set-Content -Path $caddyfile -Encoding ASCII -Value "$Domain {`n    encode gzip`n    reverse_proxy 127.0.0.1:$Port`n}"
  $caction = New-ScheduledTaskAction -Execute $caddy -Argument "run --config `"$caddyfile`"" -WorkingDirectory $InstallPath
  $csettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName "ExportDeskCaddy" -Action $caction -Trigger $trigger -Settings $csettings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName "ExportDeskCaddy"
}

# ---------- 6. check ----------
Step "Checking the backend"
$ok = $false; $h = $null
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  try { $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 5 -UseBasicParsing; if ($h.ok) { $ok = $true } } catch { }
}
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress

Write-Host ""
if ($ok) {
  Write-Host "Backend is running." -ForegroundColor Green
  if ($Domain) {
    Write-Host "  Public HTTPS : https://$Domain/api/health   (certificate is issued on the first request - allow ~30 s)"
    Write-Host "  Next: in the repo's vercel.json set the rewrite destination to https://$Domain and push; Vercel redeploys." -ForegroundColor Yellow
  } else {
    Write-Host "  On this PC     : http://localhost:$Port"
    if ($ip) { Write-Host "  On the network : http://${ip}:$Port" }
    Write-Host "  Next: forward router port $Port to this server; vercel.json rewrites must point to http://<public-ip>:$Port" -ForegroundColor Yellow
  }
  Write-Host "  Test: http://localhost:$Port/api/health"
} else {
  Write-Warning "The backend did not answer on port $Port within 60 s. Last lines of $log :"
  if (Test-Path $log) { Get-Content $log -Tail 25 }
}
$tasks = if ($Domain) { "'ExportDeskAPI' and 'ExportDeskCaddy'" } else { "'ExportDeskAPI'" }
Write-Host ""
Write-Host ("Manage in Task Scheduler: {0}   |   Log: {1}" -f $tasks, $log)
