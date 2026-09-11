# schedule-api.ps1
# Run as service or: powershell -ExecutionPolicy Bypass -File schedule-api.ps1

$ListenPrefix = 'http://+:8091/'
$JsonPath     = 'C:\Jenkins\Jobs\Dashboard\scheduled-jobs.json'
$ScheduledRoot = 'C:\Jenkins\Jobs\Dashboard\data\scheduled'
$LogRoot      = 'C:\Jenkins\Jobs\Log'

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
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $backup = "$JsonPath.bak"
    if (Test-Path $JsonPath) { Copy-Item $JsonPath $backup -Force }
    $json = ($list | ConvertTo-Json -Depth 20)
    [System.IO.File]::WriteAllText($JsonPath, $json, [System.Text.UTF8Encoding]::new($false))
}

function Remove-JobFolders([string]$folder) {
    if (-not (Test-ValidWindowsName $folder)) { return }
    $histDir = Join-Path $ScheduledRoot $folder
    if (Test-Path $histDir) {
        Remove-Item -LiteralPath $histDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    # Optional: remove matching log files JOB_*_BuildID_*.txt
    if (Test-Path $LogRoot) {
        Get-ChildItem -Path $LogRoot -Filter ($folder + '_BuildID_*.txt') -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($ListenPrefix)
$listener.Start()
Write-Host "Schedule API listening on $ListenPrefix"
Write-Host "JSON: $JsonPath"

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

        if ($req.HttpMethod -eq 'GET' -and ($path -eq '/api/scheduled-jobs' -or $path -eq '/api/scheduled-jobs/')) {
            $jobs = Read-Jobs
            $body = ($jobs | ConvertTo-Json -Depth 20)
            if ([string]::IsNullOrWhiteSpace($body)) { $body = '[]' }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.StatusCode = 200
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($req.HttpMethod -eq 'POST' -and ($path -eq '/api/scheduled-jobs' -or $path -eq '/api/scheduled-jobs/')) {
            $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
            $raw = $reader.ReadToEnd()
            $reader.Close()
            $list = $raw | ConvertFrom-Json
            if ($null -eq $list) { $list = @() }
            if ($list -isnot [System.Array]) { $list = @($list) }

            foreach ($j in $list) {
                $n = [string]$j.name
                $f = if ($j.folder) { [string]$j.folder } else { $n }
                if (-not (Test-ValidWindowsName $n)) {
                    throw "Invalid job name (Windows forbidden characters): $n"
                }
                if (-not (Test-ValidWindowsName $f)) {
                    throw "Invalid folder name (Windows forbidden characters): $f"
                }
            }

            Write-Jobs @($list)
            $ok = '{"ok":true}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($ok)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.StatusCode = 200
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($req.HttpMethod -eq 'DELETE' -and $path -eq '/api/scheduled-jobs') {
            # Body: { "name": "JOB_NAME" }  or query ?name=
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
            if ([string]::IsNullOrWhiteSpace($name)) { throw 'Missing job name' }
            if (-not (Test-ValidWindowsName $name)) { throw "Invalid name: $name" }

            $jobs = @(Read-Jobs)
            $folder = $name
            $remaining = @()
            foreach ($j in $jobs) {
                $jn = [string]$j.name
                if ($jn -eq $name) {
                    if ($j.folder) { $folder = [string]$j.folder }
                } else {
                    $remaining += $j
                }
            }

            Write-Jobs $remaining
            Remove-JobFolders $folder

            $ok = (@{ ok = $true; deleted = $name; folder = $folder } | ConvertTo-Json)
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($ok)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.StatusCode = 200
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes('{"error":"not found"}')
            $res.ContentType = 'application/json'
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
    }
    catch {
        $res.StatusCode = 400
        $err = (@{ error = $_.Exception.Message } | ConvertTo-Json)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
        $res.ContentType = 'application/json; charset=utf-8'
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    finally {
        $res.Close()
    }
}
