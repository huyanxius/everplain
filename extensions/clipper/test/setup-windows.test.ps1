# Cross-platform PowerShell core tests. Not an end-to-end Windows test.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../setup/everplain-clipper-windows.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('Everplain test 空格 ' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$archive = Join-Path $testRoot '包 package.zip'
$checksum = Join-Path $testRoot 'package.sha256'
$target = Join-Path $testRoot 'fixed 目录'
[void][IO.Directory]::CreateDirectory($target)
$passed = 0
function Assert([bool] $Condition, [string] $Message) { if (-not $Condition) { throw $Message } }
function Hash-Bytes([byte[]] $Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function New-TestPackage([string] $Extra = '', [string] $Link = '', [bool] $WrongContent = $false, [bool] $Bomb = $false) {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
    $zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
    $contents = @{}
    try {
        foreach ($file in $Files) {
            $data = [Text.Encoding]::UTF8.GetBytes("fixture $file")
            if ($Bomb -and $file -eq 'popup.js') { $data = New-Object byte[] 9000000 }
            $contents[$file] = $data
            $entry = $zip.CreateEntry($file)
            if ($Link -eq $file) { $entry.ExternalAttributes = -1577123840 } # 0xA1FF0000 symlink
            $stream = $entry.Open()
            if ($WrongContent -and $file -eq 'popup.js') { $data = [Text.Encoding]::UTF8.GetBytes('wrong') }
            try { $stream.Write($data, 0, $data.Length) } finally { $stream.Dispose() }
        }
        if ($Extra) { $entry = $zip.CreateEntry($Extra); $stream = $entry.Open(); $stream.Dispose() }
    } finally { $zip.Dispose() }
    $lines = @((Hash-Bytes ([IO.File]::ReadAllBytes($archive))) + '  everplain-clipper.zip')
    foreach ($file in $Files) { $lines += (Hash-Bytes $contents[$file]) + '  ' + $file }
    [IO.File]::WriteAllLines($checksum, $lines, (New-Object Text.UTF8Encoding($false)))
}
function Expect-Rejection([string] $Name) {
    $failed = $false
    try { $null = Expand-VerifiedPackage $archive $checksum $target } catch { $failed = $true }
    Assert $failed ('Expected rejection: ' + $Name)
    $script:passed++
    Write-Host ('PASS ' + $Name)
}
try {
    New-TestPackage
    $destination = Expand-VerifiedPackage $archive $checksum $target
    Assert (Test-Path -LiteralPath (Join-Path $destination 'manifest.json')) 'Valid package missing manifest.'
    $again = Expand-VerifiedPackage $archive $checksum $target
    Assert ($again -ceq $destination) 'Same package should reuse the directory.'
    $passed++; Write-Host 'PASS Unicode/space path, valid package and repeat reuse'
    $file = Join-Path $destination 'popup.js'; [IO.File]::WriteAllText($file, 'KEEP USER DATA')
    Expect-Rejection 'preserve modified existing directory'
    Assert ([IO.File]::ReadAllText($file) -ceq 'KEEP USER DATA') 'User file overwritten.'
    # Each bad package has a different hash and cannot accidentally reuse the original.
    foreach ($name in @('../escape', '/tmp/escape', 'C:\escape', 'popup.js:ads', './popup.js', 'popup.js', 'unknown.txt')) {
        New-TestPackage -Extra $name; Expect-Rejection ('unsafe or duplicate entry ' + $name)
    }
    New-TestPackage -Link 'popup.js'; Expect-Rejection 'symlink entry'
    New-TestPackage -WrongContent $true; Expect-Rejection 'per-file content mismatch'
    New-TestPackage -Bomb $true; Expect-Rejection 'ZIP bomb size'
    New-TestPackage; [IO.File]::AppendAllText($archive, 'corrupt'); Expect-Rejection 'archive checksum mismatch'
    [IO.File]::WriteAllText($archive, '<html>error</html>')
    $lines = [IO.File]::ReadAllLines($checksum); $lines[0] = (Hash-Bytes ([IO.File]::ReadAllBytes($archive))) + '  everplain-clipper.zip'
    [IO.File]::WriteAllLines($checksum, $lines); Expect-Rejection 'HTML masquerading as ZIP'
    Write-Host "$passed checks passed. PowerShell core only; Windows 5.1/browser not exercised."
} finally { Remove-Item -LiteralPath $testRoot -Recurse -Force }
