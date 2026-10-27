# 抓一张打包后应用的窗口截图。
#
# 不能用 CopyFromScreen —— 那个只能抓到屏幕最前面的窗口，
# 我们启动的 Electron 窗口可能被别的窗口挡住。用 PrintWindow
# 让窗口把自己画到一块内存位图上，被遮挡也不影响。
# PrintWindow 的第二个参数传 2（PW_RENDERFULLCONTENT），
# 否则 Chromium 的合成层会画成一片黑。
#
# 用法：先启动打包好的应用，再在 pwsh 里执行
#   $code = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes("$PWD\scripts\capture-window.ps1"))
#   Invoke-Expression $code
# （本机执行策略禁止直接跑 .ps1；而 Get-Content 会按 GBK 解码把中文注释读坏，
#   所以必须先用 ReadAllBytes + UTF8 取文本）

Add-Type -AssemblyName System.Drawing

$sig = @'
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    // 窗口最小化时 GetWindowRect 只返回标题栏那一条（158x26），截出来就是一条细边。
    // 截图前先 SW_RESTORE(9) 还原成正常大小。
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);

    // 本进程 DPI 不感知，GetWindowRect 返回的是「逻辑像素」（1707x1067 的坐标系），
    // 而 PrintWindow 画的是「物理像素」（真屏 2560x1600）。两者差一个缩放比，
    // 位图不按这个比例放大，右侧和下边就会被裁掉。
    // 用 DESKTOPHORZRES / 虚拟屏宽 就能算出真实缩放比。
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr hdc, int index);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
}
'@

if (-not ("Win32" -as [type])) {
    Add-Type -TypeDefinition $sig -ReferencedAssemblies System.Drawing
}

# 算出物理像素 / 逻辑像素 的缩放比（96 DPI 时就是 1）
$dc = [Win32]::GetDC([IntPtr]::Zero)
$physW = [Win32]::GetDeviceCaps($dc, 118)   # DESKTOPHORZRES
$logicalW = [Win32]::GetDeviceCaps($dc, 8)   # HORZRES（逻辑宽度）
[void][Win32]::ReleaseDC([IntPtr]::Zero, $dc)
$scale = if ($logicalW -gt 0) { [double]$physW / [double]$logicalW } else { 1.0 }
if ($scale -lt 1) { $scale = 1.0 }

$outPath = [System.IO.Path]::GetFullPath("$PWD\.shots\packaged-app.png")
New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null

# 进程名跟着可执行文件名走：0.1.1 起是可执行文件是 yichen-ledger.exe，
# 0.1.0 及更早是「忆尘记账.exe」。两个都找，谁有窗口用谁。
$proc = Get-Process -Name "yichen-ledger", "忆尘记账" -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1

if (-not $proc) {
    Write-Output "FAIL: 没有找到带窗口的进程，请先启动应用"
    return
}

$hwnd = $proc.MainWindowHandle
# 被最小化时先还原，否则拿到的是标题栏的尺寸
if ([Win32]::IsIconic($hwnd)) {
    [void][Win32]::ShowWindow($hwnd, 9)
    Start-Sleep -Milliseconds 800
}
$rect = New-Object Win32+RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$rect)
$lw = $rect.Right - $rect.Left
$lh = $rect.Bottom - $rect.Top
$w  = [int][Math]::Round($lw * $scale)
$h  = [int][Math]::Round($lh * $scale)
Write-Output "窗口: $($proc.MainWindowTitle)  逻辑 ${lw}x${lh}  缩放 x$scale  输出 ${w}x${h}"

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $gfx.GetHdc()
$ok = [Win32]::PrintWindow($hwnd, $hdc, 2)
$gfx.ReleaseHdc($hdc)
$gfx.Dispose()

if (-not $ok) {
    Write-Output "WARN: PrintWindow 返回 false，图可能不完整"
}

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "SHOT: $outPath"
