param([string]$DataDirectory = (Join-Path $PSScriptRoot '..\data'))
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($DataDirectory).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
if ($target + [System.IO.Path]::DirectorySeparatorChar -eq [System.IO.Path]::GetPathRoot($target)) { throw 'Select a private application folder, not a drive root.' }
if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw 'Create the data directory by starting the local server first.' }
$trusted = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
$items = @((Get-Item -LiteralPath $target)) + @(Get-ChildItem -LiteralPath $target -Force -Recurse)
foreach ($item in $items) {
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Private storage must not contain symbolic links or reparse points.' }
  if (-not ($item.FullName -eq $target -or $item.FullName.StartsWith($target + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase))) { throw 'Storage path escaped the selected directory.' }
}
foreach ($item in $items) {
  if ($item.PSIsContainer) { $acl = New-Object System.Security.AccessControl.DirectorySecurity; $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }
  else { $acl = New-Object System.Security.AccessControl.FileSecurity; $inherit = [System.Security.AccessControl.InheritanceFlags]::None }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in $trusted) {
    $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $item.FullName -AclObject $acl
}
$verified = (& (Join-Path $PSScriptRoot 'check-storage.ps1') -DataDirectory $target) | ConvertFrom-Json
if (-not $verified.private) { throw 'Storage permission verification failed. Run from the intended Windows server account outside a restricted sandbox.' }
Write-Output "Private storage permissions applied and verified for $target. Run the server as this Windows account."
