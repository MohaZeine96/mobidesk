param(
  [Parameter(Mandatory=$true)][string]$WindowTitle,
  [string]$ChildHandle,
  [double]$AspectRatio = 0,
  [Parameter(Mandatory=$true)][uint32]$ScrcpyProcessId,
  [Parameter(Mandatory=$true)][string]$ParentHandle,
  [Parameter(Mandatory=$true)][int]$X,
  [Parameter(Mandatory=$true)][int]$Y,
  [Parameter(Mandatory=$true)][int]$Width,
  [Parameter(Mandatory=$true)][int]$Height
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MobiDeskWindowHost {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr FindWindow(string className, string windowName);
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hwnd);
  public static IntPtr FindVisibleWindowByProcess(uint targetProcessId) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hwnd, out processId);
      if (processId == targetProcessId && IsWindowVisible(hwnd)) { found = hwnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)]
  public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)]
  public static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachInput);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr GetParent(IntPtr child);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  public static void FocusWindow(IntPtr hwnd, IntPtr parent) {
    uint processId;
    uint targetThread = GetWindowThreadProcessId(hwnd, out processId);
    uint currentThread = GetCurrentThreadId();
    SetForegroundWindow(parent);
    bool attached = currentThread != targetThread && AttachThreadInput(currentThread, targetThread, true);
    SetFocus(hwnd);
    if (attached) AttachThreadInput(currentThread, targetThread, false);
  }
  [DllImport("gdi32.dll", SetLastError=true)]
  public static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern int SetWindowRgn(IntPtr hwnd, IntPtr region, bool redraw);
  [DllImport("gdi32.dll")]
  public static extern bool DeleteObject(IntPtr handle);
}
'@
$child = [IntPtr]::Zero
if ($ChildHandle) {
  $candidate = [IntPtr]::new([Convert]::ToInt64($ChildHandle, 16))
  if ([MobiDeskWindowHost]::IsWindow($candidate)) { $child = $candidate }
}
if ($child -eq [IntPtr]::Zero) { $child = [MobiDeskWindowHost]::FindWindow($null, $WindowTitle) }
if ($child -eq [IntPtr]::Zero) { $child = [MobiDeskWindowHost]::FindVisibleWindowByProcess($ScrcpyProcessId) }
if ($child -eq [IntPtr]::Zero) { exit 3 }
$parentValue = [Convert]::ToInt64($ParentHandle, 16)
$parent = [IntPtr]::new($parentValue)
if ($parent -eq [IntPtr]::Zero) { throw 'MobiDesk window handle was empty.' }
$alreadyAttached = [MobiDeskWindowHost]::GetParent($child) -eq $parent
if ($AspectRatio -gt 0.2 -and $AspectRatio -lt 4) { $aspect = $AspectRatio }
else {
  $client = New-Object MobiDeskWindowHost+RECT
  if ([MobiDeskWindowHost]::GetClientRect($child, [ref]$client)) {
    $sourceWidth = $client.Right - $client.Left
    $sourceHeight = $client.Bottom - $client.Top
  } else { $sourceWidth = 9; $sourceHeight = 19 }
  if ($sourceWidth -lt 1 -or $sourceHeight -lt 1) { $sourceWidth = 9; $sourceHeight = 19 }
  $aspect = [double]$sourceWidth / [double]$sourceHeight
}
if (-not $alreadyAttached) {
  [void][MobiDeskWindowHost]::ShowWindow($child, 0)
  $style = [MobiDeskWindowHost]::GetWindowLongPtr($child, -16).ToInt64()
  $childStyle = ($style -band (-bnot [long]0x80CE0000)) -bor 1073741824 -bor 268435456
  [void][MobiDeskWindowHost]::SetWindowLongPtr($child, -16, [IntPtr]::new($childStyle))
  [void][MobiDeskWindowHost]::SetParent($child, $parent)
  if ([MobiDeskWindowHost]::GetParent($child) -ne $parent) { throw 'Windows did not attach the scrcpy window to MobiDesk.' }
}
$flags = 64
if (-not $alreadyAttached) { $flags = $flags -bor 32 }
if (-not [MobiDeskWindowHost]::SetWindowPos($child, [IntPtr]::Zero, $X, $Y, $Width, $Height, [uint32]$flags)) { throw 'Windows could not size the embedded scrcpy window.' }
$region = [MobiDeskWindowHost]::CreateRoundRectRgn(0, 0, $Width + 1, $Height + 1, 52, 52)
if ($region -ne [IntPtr]::Zero -and [MobiDeskWindowHost]::SetWindowRgn($child, $region, $true) -eq 0) { [void][MobiDeskWindowHost]::DeleteObject($region) }
if (-not $alreadyAttached) { [MobiDeskWindowHost]::FocusWindow($child, $parent) }
Write-Output ('MOBIDESK_HWND=' + $child.ToInt64().ToString('x'))
Write-Output ('MOBIDESK_ASPECT=' + $aspect.ToString([Globalization.CultureInfo]::InvariantCulture))
