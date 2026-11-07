# Generate PWA icons with System.Drawing (no third-party deps).
# Kept ASCII-only so Windows PowerShell 5.1 (ANSI file reading) parses it cleanly.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$glyph = [string][char]0x56DB   # U+56DB, the character for "four"

function New-Icon {
    param(
        [int]$Size,
        [string]$Path,
        [double]$Corner,      # corner radius ratio, 0 = square (maskable)
        [double]$GlyphScale   # glyph size relative to canvas
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 15, 118, 110))
    if ($Corner -gt 0) {
        $radius = [int]($Size * $Corner)
        $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
        $d = $radius * 2
        $gp.AddArc(0, 0, $d, $d, 180, 90)
        $gp.AddArc($Size - $d, 0, $d, $d, 270, 90)
        $gp.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
        $gp.AddArc(0, $Size - $d, $d, $d, 90, 90)
        $gp.CloseFigure()
        $g.FillPath($bg, $gp)
        $gp.Dispose()
    } else {
        $g.FillRectangle($bg, $rect)
    }

    $fontSize = [float]($Size * 0.52 * $GlyphScale)
    $font = New-Object System.Drawing.Font("Microsoft YaHei UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF(0, [float]($Size * 0.01), $Size, $Size)
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.DrawString($glyph, $font, $white, $textRect, $fmt)

    $small = New-Object System.Drawing.Font("Segoe UI", [float]($Size * 0.075), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $smallRect = New-Object System.Drawing.RectangleF(0, [float]($Size * 0.70), $Size, [float]($Size * 0.2))
    $sub = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(215, 255, 255, 255))
    $g.DrawString("CET-4", $small, $sub, $smallRect, $fmt)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose(); $bmp.Dispose(); $font.Dispose(); $small.Dispose()
    $bg.Dispose(); $white.Dispose(); $sub.Dispose(); $fmt.Dispose()
    Write-Host ("  {0}  {1}x{1}" -f [System.IO.Path]::GetFileName($Path), $Size)
}

New-Icon -Size 512 -Path (Join-Path $outDir "icon-512.png") -Corner 0.22 -GlyphScale 1.0
New-Icon -Size 192 -Path (Join-Path $outDir "icon-192.png") -Corner 0.22 -GlyphScale 1.0
New-Icon -Size 180 -Path (Join-Path $outDir "apple-touch-icon.png") -Corner 0 -GlyphScale 1.0
New-Icon -Size 512 -Path (Join-Path $outDir "icon-maskable-512.png") -Corner 0 -GlyphScale 0.72
Write-Host "icons written to icons/"

