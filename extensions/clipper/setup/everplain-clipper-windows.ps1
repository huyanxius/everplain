# Everplain Clipper. Requires Windows PowerShell 5.1; no administrator access.
# Does not change execution policy, remove download marks, write browser profiles,
# access credentials, or bypass Windows / organization restrictions.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Files = @('manifest.json', 'popup.html', 'popup.css', 'popup.js', 'capture.js', 'THIRD_PARTY_LICENSES.txt')
$BaseUrl = 'https://e.qunxue.xyz/downloads'
$SiteUrl = 'https://e.qunxue.xyz/app'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Net.Http

function Get-Checksums([string] $Path) {
    if ((Get-Item -LiteralPath $Path).Length -gt 4096) { throw 'Checksum list is too large.' }
    $lines = [IO.File]::ReadAllLines($Path)
    if ($lines.Length -ne 7) { throw 'Incomplete checksum list.' }
    $names = @('everplain-clipper.zip') + $Files
    $hashes = @()
    for ($i = 0; $i -lt $names.Length; $i++) {
        if ($lines[$i] -cnotmatch '^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$' -or $Matches[2] -cne $names[$i]) { throw 'Invalid checksum list.' }
        $hashes += $Matches[1]
    }
    return ,$hashes
}
function Assert-PlainDirectory([string] $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation path must be a normal directory.' }
}
function New-PrivateDirectory([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path)) { [void][IO.Directory]::CreateDirectory($Path) }
    Assert-PlainDirectory $Path
}
function Assert-PreparedDirectory([string] $Path, [string[]] $Hashes) {
    Assert-PlainDirectory $Path
    if (@(Get-ChildItem -LiteralPath $Path -Force).Count -ne $Files.Length) { throw 'Existing folder contains other files; nothing was overwritten.' }
    for ($i = 0; $i -lt $Files.Length; $i++) {
        $file = Join-Path $Path $Files[$i]
        $item = Get-Item -LiteralPath $file -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Hashes[$i + 1]) { throw 'Extension file verification failed; existing files were preserved.' }
    }
}
function Expand-VerifiedPackage([string] $Archive, [string] $Checksum, [string] $Root) {
    $hashes = Get-Checksums $Checksum
    if ((Get-Item -LiteralPath $Archive).Length -gt 8388608 -or (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hashes[0]) { throw 'Package verification failed. Please try again later.' }
    Assert-PlainDirectory $Root
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    $stage = $null
    try {
        if ($zip.Entries.Count -ne $Files.Length) { throw 'Unexpected ZIP entry count.' }
        $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        foreach ($entry in $zip.Entries) {
            # Exact flat names reject traversal, absolute paths, ADS, devices and aliases.
            if (-not ($Files -ccontains $entry.FullName) -or -not $seen.Add($entry.FullName)) { throw 'Unsafe or duplicate ZIP path.' }
            $kind = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            if ($kind -ne 0 -and $kind -ne 0x8000) { throw 'ZIP links and directories are not allowed.' }
            if ($entry.Length -gt 8388608 -or $entry.Length -lt 0) { throw 'ZIP entry exceeds size limit.' }
        }
        $destination = Join-Path $Root ('release-' + $hashes[0])
        if (Test-Path -LiteralPath $destination) { Assert-PreparedDirectory $destination $hashes; return $destination }
        $stage = Join-Path $Root ('.preparing-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($stage)
        foreach ($entry in $zip.Entries) {
            # CreateNew plus a fresh directory prevents replacing any existing data.
            $target = [IO.File]::Open((Join-Path $stage $entry.FullName), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $input = $entry.Open()
            try {
                $buffer = New-Object byte[] 65536
                [long]$total = 0
                while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $total += $read
                    if ($total -gt 8388608) { throw 'ZIP output exceeds size limit.' }
                    $target.Write($buffer, 0, $read)
                }
                if ($total -ne $entry.Length) { throw 'ZIP output length mismatch.' }
            } finally { $input.Dispose(); $target.Dispose() }
        }
        Assert-PreparedDirectory $stage $hashes
        # Directory.Move fails if the target exists, including concurrent setup runs.
        [IO.Directory]::Move($stage, $destination)
        $stage = $null
        return $destination
    } finally {
        $zip.Dispose()
        if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
}
function Save-Download([string] $Url, [string] $Path, [long] $Limit) {
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(90)
    $response = $null; $stream = $null; $output = $null
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        $response = $client.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200) { throw 'Server did not return the requested file.' }
        if ($response.Content.Headers.ContentLength -gt $Limit) { throw 'Download exceeds size limit.' }
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $output = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
        $buffer = New-Object byte[] 65536; [long]$total = 0
        while ($true) {
            $remaining = 90000 - $clock.ElapsedMilliseconds
            if ($remaining -le 0) { throw 'Download timed out.' }
            $pending = $stream.ReadAsync($buffer, 0, $buffer.Length)
            if (-not $pending.Wait([int]$remaining)) { throw 'Download timed out.' }
            $read = $pending.GetAwaiter().GetResult()
            if ($read -eq 0) { break }
            $total += $read
            if ($total -gt $Limit) { throw 'Download exceeds size limit.' }
            $output.Write($buffer, 0, $read)
        }
    } finally {
        if ($output) { $output.Dispose() }; if ($stream) { $stream.Dispose() }
        if ($response) { $response.Dispose() }; $client.Dispose(); $handler.Dispose()
    }
}
function Start-EverplainSetup {
    if ($env:OS -ne 'Windows_NT' -or $PSVersionTable.PSVersion -lt [version]'5.1') { throw 'Windows PowerShell 5.1 or later is required.' }
    Write-Host 'Everplain: downloading verified files. Browser installation stays manual.'
    $root = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Everplain'
    New-PrivateDirectory $root
    $root = Join-Path $root 'Clipper'
    New-PrivateDirectory $root
    $temp = Join-Path $root ('.download-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($temp)
    try {
        $checksum = Join-Path $temp 'package.sha256'; $archive = Join-Path $temp 'package.zip'
        Save-Download ($BaseUrl + '/everplain-clipper.sha256') $checksum 4096
        Save-Download ($BaseUrl + '/everplain-clipper.zip') $archive 8388608
        $destination = Expand-VerifiedPackage $archive $checksum $root
    } finally { Remove-Item -LiteralPath $temp -Recurse -Force }
    Write-Host "`nPrepared folder: $destination"
    $choice = Read-Host 'Browser: 1 Chrome / 2 Edge'
    $relative = $null; $extensionsUrl = $null
    if ($choice -eq '1') { $relative = 'Google\Chrome\Application\chrome.exe'; $extensionsUrl = 'chrome://extensions/' }
    if ($choice -eq '2') { $relative = 'Microsoft\Edge\Application\msedge.exe'; $extensionsUrl = 'edge://extensions/' }
    if ($relative) {
        $browser = $null
        foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            if ($base) { $candidate = Join-Path $base $relative; if (Test-Path -LiteralPath $candidate -PathType Leaf) { $browser = $candidate; break } }
        }
        if ($browser) { Start-Process -FilePath $browser -ArgumentList @($extensionsUrl, $SiteUrl) }
        else { Write-Host "Open your browser manually: $extensionsUrl and $SiteUrl" }
    }
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('"' + $destination + '"')
    Write-Host "`n1. Turn on Developer mode in the browser extensions page."
    Write-Host '2. Click Load unpacked and select the prepared folder. Sign in to Everplain in the same browser profile.'
    Write-Host 'The extension is preset to https://e.qunxue.xyz. Review the site permission on first use.'
    Write-Host 'Do not move/delete the folder. New versions use a new folder and must be loaded again.'
    Write-Host 'If system or organization policy blocks setup, stop and use the manual ZIP; do not change security settings.'
}
if ($MyInvocation.InvocationName -ne '.') {
    try { Start-EverplainSetup }
    catch { Write-Error $_; exit 1 }
}
