$port = 8080
$prefix = "http://localhost:$port/"
$baseDir = if ($PSScriptRoot) { $PSScriptRoot } else { "c:\Users\Admin\OneDrive - Safetynet Innovations Private Limited\Desktop\HS" }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  HealthySure BD Central Repository Server Started       " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  Localhost URL: $prefix" -ForegroundColor Yellow
    Write-Host "  Serving directory: $baseDir" -ForegroundColor Gray
    Write-Host "==========================================================" -ForegroundColor Cyan

    while ($listener.IsListening) {
        $context = $null
        try {
            $context = $listener.GetContext()
        } catch {
            if ($listener.IsListening) {
                Start-Sleep -Milliseconds 50
                continue
            } else {
                break
            }
        }

        $response = $null
        try {
            $request = $context.Request
            $response = $context.Response

            $rawPath = $request.Url.LocalPath.TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($rawPath)) {
                $rawPath = "index.html"
            }

            # URL decode path
            $decodedPath = [System.Uri]::UnescapeDataString($rawPath)
            $filePath = Join-Path $baseDir $decodedPath

            # Add CORS headers
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

            if ($request.HttpMethod -eq "OPTIONS") {
                $response.StatusCode = 200
                $response.Close()
                continue
            }

            # Apollo.io API Proxy (Prevents browser CORS restrictions)
            if ($rawPath -eq "api/apollo") {
                try {
                    $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                    $body = $reader.ReadToEnd()
                    $reader.Close()

                    $apolloResp = Invoke-WebRequest -Uri "https://api.apollo.io/v1/mixed_people/search" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 15
                    $response.StatusCode = $apolloResp.StatusCode
                    $response.ContentType = "application/json; charset=utf-8"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($apolloResp.Content)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } catch {
                    $response.StatusCode = 500
                    $safeErr = $_.Exception.Message.Replace('"', '\"')
                    $errMsg = [System.Text.Encoding]::UTF8.GetBytes("{\`"error\`": \`"$safeErr\`"}")
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $errMsg.Length
                    $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
                }
                $response.Close()
                continue
            }

            # Prospeo.io API Proxy (Prevents browser CORS restrictions)
            if ($rawPath -eq "api/prospeo") {
                try {
                    $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                    $body = $reader.ReadToEnd()
                    $reader.Close()

                    $prospeoKey = $request.Headers["X-KEY"]
                    if ([string]::IsNullOrWhiteSpace($prospeoKey)) {
                        $prospeoKey = $request.Headers["Authorization"]
                    }

                    $headers = @{
                        "Content-Type" = "application/json"
                    }
                    if (-not [string]::IsNullOrWhiteSpace($prospeoKey)) {
                        $headers["X-KEY"] = $prospeoKey
                    }

                    $prospeoResp = Invoke-WebRequest -Uri "https://api.prospeo.io/domain-search" -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 15
                    $response.StatusCode = $prospeoResp.StatusCode
                    $response.ContentType = "application/json; charset=utf-8"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($prospeoResp.Content)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } catch {
                    $response.StatusCode = 500
                    $safeErr = $_.Exception.Message.Replace('"', '\"')
                    $errMsg = [System.Text.Encoding]::UTF8.GetBytes("{\`"error\`": \`"$safeErr\`"}")
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $errMsg.Length
                    $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
                }
                $response.Close()
                continue
            }

            # Save Company Record API
            if ($rawPath -eq "api/save_company") {
                try {
                    $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                    $body = $reader.ReadToEnd()
                    $reader.Close()

                    $editsFile = Join-Path $baseDir "founder_edits.jsonl"
                    $parsed = $body | ConvertFrom-Json
                    $logLine = @{
                        timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
                        companyId = $parsed.id
                        companyName = $parsed.name
                        data = $parsed
                    } | ConvertTo-Json -Compress
                    [System.IO.File]::AppendAllText($editsFile, $logLine + "`r`n", [System.Text.Encoding]::UTF8)

                    $response.StatusCode = 200
                    $response.ContentType = "application/json; charset=utf-8"
                    $msgBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success": true, "message": "Changes saved to server"}')
                    $response.ContentLength64 = $msgBytes.Length
                    $response.OutputStream.Write($msgBytes, 0, $msgBytes.Length)
                } catch {
                    $response.StatusCode = 500
                    $safeErr = $_.Exception.Message.Replace('"', '\"')
                    $errMsg = [System.Text.Encoding]::UTF8.GetBytes("{\`"error\`": \`"$safeErr\`"}")
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $errMsg.Length
                    $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
                }
                $response.Close()
                continue
            }

            # Founder Review Feedback / Notes API
            if ($rawPath -eq "api/feedback") {
                try {
                    $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                    $body = $reader.ReadToEnd()
                    $reader.Close()

                    $fbFile = Join-Path $baseDir "founder_feedback.json"
                    $existing = @()
                    if (Test-Path $fbFile) {
                        try { $existing = (Get-Content $fbFile -Raw -Encoding UTF8) | ConvertFrom-Json } catch { $existing = @() }
                    }
                    $newEntry = $body | ConvertFrom-Json
                    $newEntry | Add-Member -NotePropertyName "receivedAt" -NotePropertyValue (Get-Date -Format "yyyy-MM-dd HH:mm:ss") -Force
                    $existing = @($existing) + @($newEntry)
                    $jsonOut = $existing | ConvertTo-Json -Depth 5
                    [System.IO.File]::WriteAllText($fbFile, $jsonOut, [System.Text.Encoding]::UTF8)

                    $response.StatusCode = 200
                    $response.ContentType = "application/json; charset=utf-8"
                    $msgBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success": true, "message": "Feedback recorded successfully"}')
                    $response.ContentLength64 = $msgBytes.Length
                    $response.OutputStream.Write($msgBytes, 0, $msgBytes.Length)
                } catch {
                    $response.StatusCode = 500
                    $safeErr = $_.Exception.Message.Replace('"', '\"')
                    $errMsg = [System.Text.Encoding]::UTF8.GetBytes("{\`"error\`": \`"$safeErr\`"}")
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $errMsg.Length
                    $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
                }
                $response.Close()
                continue
            }

            if (Test-Path $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $mime = switch ($ext) {
                    ".html" { "text/html; charset=utf-8" }
                    ".css"  { "text/css; charset=utf-8" }
                    ".js"   { "application/javascript; charset=utf-8" }
                    ".json" { "application/json; charset=utf-8" }
                    ".csv"  { "text/csv; charset=utf-8" }
                    ".xlsx" { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
                    ".xlsm" { "application/vnd.ms-excel.sheet.macroEnabled.12" }
                    ".png"  { "image/png" }
                    ".svg"  { "image/svg+xml" }
                    default { "application/octet-stream" }
                }

                $response.ContentType = $mime
                
                $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentLength64 = $fileBytes.Length
                $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)
            } else {
                $response.StatusCode = 404
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }

            $response.Close()
        } catch {
            if ($response -ne $null) {
                try { $response.Close() } catch {}
            }
        }
    }
} catch {
    Write-Host "Server encountered an error: $_" -ForegroundColor Red
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}
