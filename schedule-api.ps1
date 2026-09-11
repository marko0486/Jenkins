# ============================================================================
# schedule-api.ps1
# HTTP API for scheduled-jobs.json (GET / POST / DELETE)
# Run:  powershell -ExecutionPolicy Bypass -File C:\Jenkins\Jobs\Dashboard\schedule-api.ps1
# Or install as Windows service with NSSM
# ============================================================================

$ListenPrefix    = 'http://+:8091/'
$JsonPath        = 'C:\Jenkins\Jobs\Dashboard\scheduled-jobs.json'
$ScheduledRoot   = 'C:\Jenkins\Jobs\Dashboard\data\scheduled'
$SchedulerDir    = 'C:\Jenkins\Jobs\Dashboard\data\scheduler'
$LastRunFile     = 'C:\Jenkins\Jobs\Dashboard\data\scheduler\last-run.json'
$LogRoot         = 'C:\Jenkins\Jobs\Log'

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

# Windows forbidden filename characters: \ / : * ? " < > |
function Test-ValidWindowsName([string]$name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return $false }
    if ($name -match '[\\/:*?"<>|]') { return $false }
    if ($name -match '^\s|\s$') { return $false }
    if ($name -eq '.' -or $name -eq '..') { return $false }
    return $true
}

function Read-Jobs {
    if (-not (Test-Path $JsonPath)) { return @() }
    $raw = Get-Content -Path $JsonPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw) -or $raw.Trim() -eq '[]') { return @() }
    $parsed = $raw | ConvertFrom-Json
    if ($parsed -is [System.Array]) { return @($parsed) }
    return @($parsed)
}

function Write-Jobs($list) {
    $dir = Split-Path $JsonPath -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    if (Test-Path $JsonPath) {
        Copy-Item $JsonPath "$JsonPath.bak" -Force
    }
    $arr = @($list)
    if ($arr.Count -eq 0) {
        $json = '[]'
    } else {
        $json = ($arr | ConvertTo-Json -Depth 20)
    }
    [System.IO.File]::WriteAllText($JsonPath, $json, [System.Text.UTF8Encoding]::new($false))
}

function Remove-JobTraces([string]$jobName, [string]$folder) {
    if (-not (Test-ValidWindowsName $jobName)) { return }
    if ([string]::IsNullOrWhiteSpace($folder)) { $folder = $jobName }
    if (-not (Test-ValidWindowsName $folder)) { return }

    # 1) data/scheduled/<folder>
    $histDir = Join-Path $ScheduledRoot $folder
    if (Test-Path -LiteralPath $histDir) {
        Remove-Item -LiteralPath $histDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Removed folder: $histDir"
    }

    # If folder != job name, also remove data/scheduled/<jobName>
    if ($folder -ne $jobName) {
        $alt = Join-Path $ScheduledRoot $jobName
        if (Test-Path -LiteralPath $alt) {
            Remove-Item -LiteralPath $alt -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "Removed folder: $alt"
        }
    }

    # 2) Clean entry from data/scheduler/last-run.json
    if (Test-Path $LastRunFile) {
        try {
            $raw = Get-Content -Path $LastRunFile -Raw -Encoding UTF8
            if ($raw -and $raw.Trim() -ne '' -and $raw.Trim() -ne '{}') {
                $map = $raw | ConvertFrom-Json
                $ht = @{}
                if ($null -ne $map) {
                    $map.PSObject.Properties | ForEach-Object {
                        if ($_.Name -ne $jobName -and $_.Name -ne $folder) {
                            $ht[$_.Name] = $_.Value
                        }
                    }
                }
                $out = if ($ht.Count -eq 0) { '{}' } else { ($ht | ConvertTo-Json -Depth 10) }
                [System.IO.File]::WriteAllText($LastRunFile, $out, [System.Text.UTF8Encoding]::new($false))
                Write-Host "Cleaned last-run.json for: $jobName"
            }
        }
        catch {
            Write-Host "WARNING last-run.json: $($_.Exception.Message)"
        }
    }

    # 3) Logs: C:\Jenkins\Jobs\Log\<name>_BuildID_*.txt
    if (Test-Path $LogRoot) {
        Get-ChildItem -Path $LogRoot -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -like ($folder + '_BuildID_*.txt') -or
                $_.Name -like ($jobName + '_BuildID_*.txt')
            } |
            ForEach-Object {
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                Write-Host "Removed log: $($_.FullName)"
            }
    }
}

function Send-Json($res, [int]$status, $obj) {
    $body = if ($obj -is [string]) { $obj } else { ($obj | ConvertTo-Json -Depth 20 -Compress) }
    if ([string]::IsNullOrWhiteSpace($body)) { $body = '{}' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $res.StatusCode = $status
    $res.ContentType = 'application/json; charset=utf-8'
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

# ----------------------------------------------------------------------------
# Ensure base folders exist
# ----------------------------------------------------------------------------
foreach ($d in @((Split-Path $JsonPath -Parent), $ScheduledRoot, $SchedulerDir, $LogRoot)) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}
if (-not (Test-Path $JsonPath)) {
    [System.IO.File]::WriteAllText($JsonPath, '[]', [System.Text.UTF8Encoding]::new($false))
}

# ----------------------------------------------------------------------------
# HTTP Listener
# ----------------------------------------------------------------------------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($ListenPrefix)

try {
    $listener.Start()
}
catch {
    Write-Host "ERROR starting listener on $ListenPrefix"
    Write-Host $_.Exception.Message
    Write-Host "Tip: run once as Administrator:"
    Write-Host "  netsh http add urlacl url=$ListenPrefix user=Everyone"
    exit 1
}

Write-Host "========================================"
Write-Host " Schedule API listening on $ListenPrefix"
Write-Host " JSON file : $JsonPath"
Write-Host " Scheduled : $ScheduledRoot"
Write-Host " Last-run  : $LastRunFile"
Write-Host " Logs      : $LogRoot"
Write-Host "========================================"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    # CORS
    $res.Headers.Add('Access-Control-Allow-Origin', '*')
    $res.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    $res.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

    if ($req.HttpMethod -eq 'OPTIONS') {
        $res.StatusCode = 204
        $res.Close()
        continue
    }

    try {
        $path = $req.Url.AbsolutePath.TrimEnd('/')
        if ([string]::IsNullOrWhiteSpace($path)) { $path = '/' }

        Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $($req.HttpMethod) $path"

        # ------------------------------------------------------------------
        # GET /api/scheduled-jobs
        # ------------------------------------------------------------------
        if ($req.HttpMethod -eq 'GET' -and ($path -eq '/api/scheduled-jobs' -or $path -eq '/api/scheduled-jobs/')) {
            $jobs = Read-Jobs
            $body = if (@($jobs).Count -eq 0) { '[]' } else { (@($jobs) | ConvertTo-Json -Depth 20) }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
            $res.StatusCode = 200
            $res.ContentType = 'application/json; charset=utf-8'
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }

        # ------------------------------------------------------------------
        # POST /api/scheduled-jobs  (replace full list)
        # ------------------------------------------------------------------
        elseif ($req.HttpMethod -eq 'POST' -and ($path -eq '/api/scheduled-jobs' -or $path -eq '/api/scheduled-jobs/')) {
            $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
            $raw = $reader.ReadToEnd()
            $reader.Close()

            if ([string]::IsNullOrWhiteSpace($raw)) {
                throw 'Empty body'
            }

            $list = $raw | ConvertFrom-Json
            if ($null -eq $list) { $list = @() }
            if ($list -isnot [System.Array]) { $list = @($list) }

            foreach ($j in $list) {
                $n = [string]$j.name
                $f = if ($j.folder) { [string]$j.folder } else { $n }
                if (-not (Test-ValidWindowsName $n)) {
                    throw "Invalid job name (Windows forbidden characters \\ / : * ? `" < > | ): $n"
                }
                if (-not (Test-ValidWindowsName $f)) {
                    throw "Invalid folder name (Windows forbidden characters): $f"
                }
            }

            Write-Jobs @($list)
            Send-Json $res 200 @{ ok = $true; count = @($list).Count }
            Write-Host "  Saved $(@($list).Count) job(s) to $JsonPath"
        }

        # ------------------------------------------------------------------
        # DELETE /api/scheduled-jobs?name=JOB_NAME
        # Body optional: { "name": "JOB_NAME" }
        # ------------------------------------------------------------------
        elseif ($req.HttpMethod -eq 'DELETE' -and ($path -eq '/api/scheduled-jobs' -or $path -eq '/api/scheduled-jobs/')) {
            $name = $req.QueryString['name']

            if ([string]::IsNullOrWhiteSpace($name)) {
                $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
                $raw = $reader.ReadToEnd()
                $reader.Close()
                if ($raw) {
                    $obj = $raw | ConvertFrom-Json
                    $name = [string]$obj.name
                }
            }

            if ([string]::IsNullOrWhiteSpace($name)) {
                throw 'Missing job name (query ?name= or JSON body { "name": "..." })'
            }
            if (-not (Test-ValidWindowsName $name)) {
                throw "Invalid name: $name"
            }

            $jobs = @(Read-Jobs)
            $folder = $name
            $found = $false
            $remaining = @()

            foreach ($j in $jobs) {
                $jn = [string]$j.name
                if ($jn -eq $name) {
                    $found = $true
                    if ($j.folder) { $folder = [string]$j.folder }
                }
                else {
                    $remaining += $j
                }
            }

            if (-not $found) {
                # Still try to clean folders/logs even if not in JSON
                Write-Host "  Job not in JSON, cleaning traces anyway: $name"
            }

            Write-Jobs $remaining
            Remove-JobTraces -jobName $name -folder $folder

            Send-Json $res 200 @{
                ok      = $true
                deleted = $name
                folder  = $folder
                remaining = @($remaining).Count
            }
            Write-Host "  Deleted job=$name folder=$folder remaining=$(@($remaining).Count)"
        }

        # ------------------------------------------------------------------
        # Health
        # ------------------------------------------------------------------
        elseif ($req.HttpMethod -eq 'GET' -and ($path -eq '/api/health' -or $path -eq '/health')) {
            Send-Json $res 200 @{
                ok      = $true
                time    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                json    = $JsonPath
                jobs    = @(Read-Jobs).Count
            }
        }

        else {
            Send-Json $res 404 @{ error = 'not found'; path = $path; method = $req.HttpMethod }
        }
    }
    catch {
        Write-Host "  ERROR: $($_.Exception.Message)"
        try {
            Send-Json $res 400 @{ error = $_.Exception.Message }
        }
        catch {
            $res.StatusCode = 500
        }
    }
    finally {
        try { $res.Close() } catch {}
    }
}
