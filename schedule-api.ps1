Sustituye Remove-JobFolders: 

$ListenPrefix   = 'http://+:8091/'
$JsonPath       = 'C:\Jenkins\Jobs\Dashboard\scheduled-jobs.json'
$ScheduledRoot  = 'C:\Jenkins\Jobs\Dashboard\data\scheduled'
$SchedulerDir   = 'C:\Jenkins\Jobs\Dashboard\data\scheduler'
$LastRunFile    = 'C:\Jenkins\Jobs\Dashboard\data\scheduler\last-run.json'
$LogRoot        = 'C:\Jenkins\Jobs\Log'

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
    if (Test-Path $JsonPath) { Copy-Item $JsonPath "$JsonPath.bak" -Force }
    $json = if ($null -eq $list -or @($list).Count -eq 0) { '[]' } else { (@($list) | ConvertTo-Json -Depth 20) }
    [System.IO.File]::WriteAllText($JsonPath, $json, [System.Text.UTF8Encoding]::new($false))
}

function Remove-JobTraces([string]$jobName, [string]$folder) {
    if (-not (Test-ValidWindowsName $jobName)) { return }
    if ([string]::IsNullOrWhiteSpace($folder)) { $folder = $jobName }
    if (-not (Test-ValidWindowsName $folder)) { return }

    # 1) data/scheduled/<folder>  (history.json, etc.)
    $histDir = Join-Path $ScheduledRoot $folder
    if (Test-Path -LiteralPath $histDir) {
        Remove-Item -LiteralPath $histDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Removed folder: $histDir"
    }

    # Also try job name if different from folder
    if ($folder -ne $jobName) {
        $alt = Join-Path $ScheduledRoot $jobName
        if (Test-Path -LiteralPath $alt) {
            Remove-Item -LiteralPath $alt -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "Removed folder: $alt"
        }
    }

    # 2) Remove entry from data/scheduler/last-run.json
    if (Test-Path $LastRunFile) {
        try {
            $raw = Get-Content -Path $LastRunFile -Raw -Encoding UTF8
            if ($raw -and $raw.Trim() -ne '' -and $raw.Trim() -ne '{}') {
                $map = $raw | ConvertFrom-Json
                # Convert to hashtable we can mutate
                $ht = @{}
                if ($map -ne $null) {
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
        } catch {
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




En el handler DELETE, llama así:

        elseif ($req.HttpMethod -eq 'DELETE' -and $path -eq '/api/scheduled-jobs') {
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
            Remove-JobTraces -jobName $name -folder $folder

            $ok = (@{ ok = $true; deleted = $name; folder = $folder } | ConvertTo-Json)
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($ok)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.StatusCode = 200
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }




        






