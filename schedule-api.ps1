# schedule-api.ps1
# Escucha en http://0.0.0.0:8091/  (puerto distinto al del HTML)
# POST /api/scheduled-jobs   body = JSON array completo
# GET  /api/scheduled-jobs   lee el archivo

$prefix = "http://+:8091/"
$jsonPath = "C:\Jenkins\Jobs\Dashboard\scheduled-jobs.json"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Schedule API on $prefix → $jsonPath"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    # CORS (Dashboard en :8090)
    $res.Headers.Add("Access-Control-Allow-Origin", "*")
    $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

    if ($req.HttpMethod -eq "OPTIONS") {
        $res.StatusCode = 204
        $res.Close()
        continue
    }

    try {
        if ($req.Url.AbsolutePath -eq "/api/scheduled-jobs") {
            if ($req.HttpMethod -eq "GET") {
                $body = if (Test-Path $jsonPath) { Get-Content $jsonPath -Raw -Encoding UTF8 } else { "[]" }
                $bytes = [Text.Encoding]::UTF8.GetBytes($body)
                $res.ContentType = "application/json; charset=utf-8"
                $res.StatusCode = 200
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            elseif ($req.HttpMethod -eq "POST") {
                $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                $reader.Close()

                # Validar que sea array JSON
                $null = $body | ConvertFrom-Json

                $dir = Split-Path $jsonPath
                if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

                # Backup
                if (Test-Path $jsonPath) {
                    Copy-Item $jsonPath "$jsonPath.bak" -Force
                }

                [IO.File]::WriteAllText($jsonPath, $body, [Text.UTF8Encoding]::new($false))

                $ok = '{"ok":true}'
                $bytes = [Text.Encoding]::UTF8.GetBytes($ok)
                $res.ContentType = "application/json"
                $res.StatusCode = 200
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
                Write-Host "$(Get-Date -Format o) Saved scheduled-jobs.json ($($body.Length) bytes)"
            }
            else {
                $res.StatusCode = 405
            }
        }
        else {
            $res.StatusCode = 404
        }
    }
    catch {
        $err = @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json
        $bytes = [Text.Encoding]::UTF8.GetBytes($err)
        $res.ContentType = "application/json"
        $res.StatusCode = 400
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host "ERROR: $($_.Exception.Message)"
    }
    $res.Close()
}
