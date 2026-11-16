param([string]$DataDirectory = (Join-Path $PSScriptRoot '..\data'))
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($DataDirectory).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
if ($target + [System.IO.Path]::DirectorySeparatorChar -eq [System.IO.Path]::GetPathRoot($target)) { throw 'Select a private application folder, not a drive root.' }
$trusted = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
$private = Test-Path -LiteralPath $target -PathType Container
if ($private) {
  $items = @((Get-Item -LiteralPath $target)) + @(Get-ChildItem -LiteralPath $target -Force -Recurse)
  foreach ($item in $items) {
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { $private = $false; break }
    $rules = (Get-Acl -LiteralPath $item.FullName).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted) { $private = $false }
    }
  }
}
@{ private = [bool]$private } | ConvertTo-Json -Compress
