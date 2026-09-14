# schedule-api.ps1
# HTTP API for scheduled-jobs.json  (port 8091)
# Run: powershell -ExecutionPolicy Bypass -File C:\Jenkins\Jobs\Dashboard\schedule-api.ps1

$ErrorActionPreference = 'Stop'
$Port            = 8091
$Root            = 'C:\Jenkins\Jobs\Dashboard'
$JobsFile        = Join-Path $Root 'scheduled-jobs.json'
$DataRoot        = Join-Path $Root 'data'
$SchedulerDir    = Join-Path $DataRoot 'scheduler'
$LastRunFile     = Join-Path $SchedulerDir 'last-run.json'
$FailureCounts   = Join-Path $SchedulerDir 'failure-counts.json'
$LogDir          = 'C:\Jenkins\Jobs\Log'
$Prefix          = "http://+:$Port/"

if (-not (Test-Path $Root))         { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
if (-not (Test-Path $SchedulerDir)) { New-Item -ItemType Directory -Path $SchedulerDir -Force | Out-Null }
if (-not (Test-Path $JobsFile))     { [System.IO.File]::WriteAllText($JobsFile, '[]', [System.Text.UTF8Encoding]::new($false)) }

function Test-ValidWindowsName([string]$name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return $false }
    if ($name -match '[\\/:*?"<>|]') { return $false }
    if ($name -eq '.' -or $name -eq '..') { return $false }
    if ($name.StartsWith(' ') -or $name.EndsWith(' ')) { return $false }
    return $true
}

function Read-Jobs {
    try {
        $raw = [System.IO.File]::ReadAllText($JobsFile, [System.Text.Encoding]::UTF8).Trim()
        if ([string]::IsNullOrWhiteSpace($raw) -or $raw -eq '[]') { return @() }
        $parsed = $raw | ConvertFrom-Json
        if ($parsed -is [System.Array]) { return @($parsed) }
        if ($null -ne $parsed) { return @($parsed) }
        return @()
    } catch {
        Write-Host "Read-Jobs error: $($_.Exception.Message)"
        return @()
    }
}

function Write-Jobs($list) {
    $arr = @($list)
    $json = if ($arr.Count -eq 0) {
        '[]'
    } else {
        $tmp = $arr | ConvertTo-Json -Depth 20
        if ($arr.Count -eq 1 -and $tmp.Trim().StartsWith('{')) { $tmp = "[$tmp]" }
        $tmp
    }
    $bak = "$JobsFile.bak"
    if (Test-Path $JobsFile) { Copy-Item -LiteralPath $JobsFile -Destination $bak -Force }
    [System.IO.File]::WriteAllText($JobsFile, $json, [System.Text.UTF8Encoding]::new($false))
}

function Remove-FailureCount([string]$jobName, [string]$folder) {
    if (-not (Test-Path -LiteralPath $FailureCounts)) { return }
    try {
        $raw = [System.IO.File]::ReadAllText($FailureCounts, [System.Text.Encoding]::UTF8).Trim()
        if ([string]::IsNullOrWhiteSpace($raw) -or $raw -eq '{}') { return }
        $obj = $raw | ConvertFrom-Json
        $ht = [ordered]@{}
        if ($obj -is [System.Management.Automation.PSCustomObject]) {
            $obj.PSObject.Properties | ForEach-Object { $ht[$_.Name] = $_.Value }
        }
        $changed = $false
        if ($jobName -and $ht.Contains($jobName)) { $ht.Remove($jobName); $changed = $true }
        if ($folder -and $ht.Contains($folder)) { $ht.Remove($folder); $changed = $true }
        if ($changed) {
            $json = if ($ht.Count -eq 0) { '{}' } else { ($ht | ConvertTo-Json -Depth 8) }
            [System.IO.File]::WriteAllText($FailureCounts, $json, [System.Text.UTF8Encoding]::new($false))
            Write-Host "Removed failure-counts for $jobName"
        }
    } catch {
        Write-Host "WARNING failure-counts cleanup: $($_.Exception.Message)"
    }
}

function Remove-JobTraces([string]$jobName, [string]$folder) {
    if ([string]::IsNullOrWhiteSpace($folder)) { $folder = $jobName }

    $schedFolder = Join-Path $DataRoot "scheduled\$folder"
    if (Test-Path -LiteralPath $schedFolder) {
        try {
            Remove-Item -LiteralPath $schedFolder -Recurse -Force -ErrorAction Stop
            Write-Host "Removed folder: $schedFolder"
        } catch {
            Write-Host "WARNING remove folder: $($_.Exception.Message)"
        }
    }

    if (Test-Path -LiteralPath $LastRunFile) {
        try {
            $raw = [System.IO.File]::ReadAllText($LastRunFile, [System.Text.Encoding]::UTF8).Trim()
            if ($raw -and $raw -ne '{}') {
                $obj = $raw | ConvertFrom-Json
                $ht = [ordered]@{}
                if ($obj -is [System.Management.Automation.PSCustomObject]) {
                    $obj.PSObject.Properties | ForEach-Object { $ht[$_.Name] = $_.Value }
                }
                $changed = $false
                if ($ht.Contains($jobName)) { $ht.Remove($jobName); $changed = $true }
                if ($folder -and $ht.Contains($folder)) { $ht.Remove($folder); $changed = $true }
                if ($changed) {
                    $json = if ($ht.Count -eq 0) { '{}' } else { ($ht | ConvertTo-Json -Depth 8) }
                    [System.IO.File]::WriteAllText($LastRunFile, $json, [System.Text.UTF8Encoding]::new($false))
                }
            }
        } catch {
            Write-Host "WARNING last-run cleanup: $($_.Exception.Message)"
        }
    }

    Remove-FailureCount -jobName $jobName -folder $folder

    if (Test-Path -LiteralPath $LogDir) {
        Get-ChildItem -LiteralPath $LogDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "$jobName*" -or ($folder -and $_.Name -like "$folder*") } |
            ForEach-Object {
                try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } catch {}
            }
    }
}

function Send-Json($response, $statusCode, $obj) {
    $json = $obj | ConvertTo-Json -Depth 20 -Compress
    if ($null -eq $json) { $json = '[]' }
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.StatusCode = $statusCode
    $response.ContentType = 'application/json; charset=utf-8'
    $response.Headers.Add('Access-Control-Allow-Origin', '*')
    $response.Headers.Add('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
    $response.ContentLength64 = $buffer.Length
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.OutputStream.Close()
}

function Send-Text($response, $statusCode, $text) {
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($text)
    $response.StatusCode = $statusCode
    $response.ContentType = 'text/plain; charset=utf-8'
    $response.Headers.Add('Access-Control-Allow-Origin', '*')
    $response.ContentLength64 = $buffer.Length
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.OutputStream.Close()
}

# Startup repair
try {
    $jobs = Read-Jobs
    $jobs = @($jobs | Where-Object { $_ -ne $null -and ($_.name -or $_.job) })
    Write-Jobs $jobs
    Write-Host "Loaded $($jobs.Count) scheduled job(s)"
} catch {
    Write-Host "Startup repair: $($_.Exception.Message)"
    Write-Jobs @()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)
try {
    $listener.Start()
} catch {
    Write-Host "ERROR starting listener on $Prefix"
    Write-Host $_.Exception.Message
    Write-Host "Try: netsh http add urlacl url=$Prefix user=Everyone"
    exit 1
}

Write-Host "Schedule API listening on http://0.0.0.0:$Port/"
Write-Host "Jobs file: $JobsFile"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $method = $req.HttpMethod.ToUpperInvariant()
    $path = $req.Url.AbsolutePath.TrimEnd('/')
    if ([string]::IsNullOrEmpty($path)) { $path = '/' }

    try {
        if ($method -eq 'OPTIONS') {
            $res.StatusCode = 204
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.Headers.Add('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
            $res.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
            $res.Close()
            continue
        }

        if ($method -eq 'GET' -and ($path -eq '/api/health' -or $path -eq '/health')) {
            Send-Json $res 200 @{ status = 'ok'; time = (Get-Date).ToString('s') }
            continue
        }

        if ($method -eq 'GET' -and ($path -eq '/api/scheduled-jobs' -or $path -eq '/api/scheduled-jobs/')) {
            $jobs = Read-Jobs
            Send-Json $res 200 @($jobs)
            continue
        }

        if ($method -eq 'POST' -and ($path -eq '/api/scheduled-jobs' -or $path -eq '/api/scheduled-jobs/')) {
            $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $reader.Close()
            $parsed = $body | ConvertFrom-Json
            $list = @()
            if ($parsed -is [System.Array]) { $list = @($parsed) }
            elseif ($null -ne $parsed) { $list = @($parsed) }

            foreach ($j in $list) {
                $n = if ($j.name) { [string]$j.name } else { [string]$j.job }
                $f = if ($j.folder) { [string]$j.folder } else { $n }
                if (-not (Test-ValidWindowsName $n)) {
                    Send-Text $res 400 "Invalid job name (Windows reserved characters): $n"
                    continue 2
                }
                if (-not (Test-ValidWindowsName $f)) {
                    Send-Text $res 400 "Invalid folder name (Windows reserved characters): $f"
                    continue 2
                }
            }
            Write-Jobs $list
            Send-Json $res 200 @{ ok = $true; count = $list.Count }
            continue
        }

        if ($method -eq 'DELETE' -and ($path -eq '/api/scheduled-jobs' -or $path -eq '/api/scheduled-jobs/')) {
            $name = $req.QueryString['name']
            if ([string]::IsNullOrWhiteSpace($name)) {
                Send-Text $res 400 'Missing query parameter: name'
                continue
            }
            $jobs = Read-Jobs
            $folder = $name
            $kept = @()
            foreach ($j in $jobs) {
                $n = if ($j.name) { [string]$j.name } else { [string]$j.job }
                if ($n -eq $name) {
                    if ($j.folder) { $folder = [string]$j.folder }
                } else {
                    $kept += $j
                }
            }
            Write-Jobs $kept
            Remove-JobTraces -jobName $name -folder $folder
            Send-Json $res 200 @{ ok = $true; deleted = $name; remaining = $kept.Count }
            continue
        }

        Send-Text $res 404 "Not found: $method $path"
    } catch {
        try { Send-Text $res 500 $_.Exception.Message } catch {}
        Write-Host "ERROR: $($_.Exception.Message)"
    }
}
