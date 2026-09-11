schedule-api.ps1 — Write-Jobs y Read-Jobs correctos
Sustituye estas dos funciones:


function Read-Jobs {
    if (-not (Test-Path $JsonPath)) { return @() }
    $raw = Get-Content -Path $JsonPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    $trim = $raw.Trim()
    if ($trim -eq '' -or $trim -eq '[]' -or $trim -eq 'null') { return @() }

    $parsed = $trim | ConvertFrom-Json

    # Single object (bad save) → wrap as array of 1
    if ($null -eq $parsed) { return @() }
    if ($parsed -is [System.Array]) { return @($parsed) }
    # PSCustomObject / Hashtable → one job
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

    # ALWAYS write a JSON array, even with 0 or 1 items
    $arr = @($list)
    if ($arr.Count -eq 0) {
        $json = '[]'
    }
    elseif ($arr.Count -eq 1) {
        # ConvertTo-Json on 1 object drops [ ]; force array wrapper
        $one = ($arr[0] | ConvertTo-Json -Depth 20)
        $json = '[' + $one + ']'
    }
    else {
        $json = ($arr | ConvertTo-Json -Depth 20)
    }

    [System.IO.File]::WriteAllText($JsonPath, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  Write-Jobs count=$($arr.Count) path=$JsonPath"
}



En el POST, después de validar:

            # Normalize to array of hashtables/objects
            $normalized = @()
            foreach ($j in @($list)) {
                $normalized += $j
            }
            Write-Jobs $normalized
            Send-Json $res 200 @{ ok = $true; count = $normalized.Count }




