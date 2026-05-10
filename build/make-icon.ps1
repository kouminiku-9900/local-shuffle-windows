# Generates build/icon.png — a cyberpunk-themed 256x256 app icon.
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $PSCommandPath
$out = Join-Path $here 'icon.png'

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# Background gradient (matches the modal frame)
$rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$bg1 = [System.Drawing.Color]::FromArgb(255, 10, 16, 26)
$bg2 = [System.Drawing.Color]::FromArgb(255, 4, 7, 12)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $bg1, $bg2, 90
$g.FillRectangle($bgBrush, $rect)

# Outer cyan border
$cyan = [System.Drawing.Color]::FromArgb(255, 0, 216, 255)
$cyanGlow = [System.Drawing.Color]::FromArgb(180, 0, 216, 255)
$borderPen = New-Object System.Drawing.Pen $cyan, 4
$g.DrawRectangle($borderPen, 6, 6, $size - 12, $size - 12)

# Cyan glow underline
$glowPen = New-Object System.Drawing.Pen $cyanGlow, 1.5
$g.DrawRectangle($glowPen, 14, 14, $size - 28, $size - 28)

# Pink corner brackets
$pink = [System.Drawing.Color]::FromArgb(255, 255, 55, 183)
$cornerPen = New-Object System.Drawing.Pen $pink, 5
$cornerLen = 30
$g.DrawLine($cornerPen, 6, 6, 6 + $cornerLen, 6)
$g.DrawLine($cornerPen, 6, 6, 6, 6 + $cornerLen)
$g.DrawLine($cornerPen, $size - 6, $size - 6, $size - 6 - $cornerLen, $size - 6)
$g.DrawLine($cornerPen, $size - 6, $size - 6, $size - 6, $size - 6 - $cornerLen)

# Big "LS" text (cyan with subtle pink shadow for the cyber feel)
$font = New-Object System.Drawing.Font("Consolas", [single]110, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$cx = $size / 2.0
$cy = $size / 2.0 - 4

$shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(160, 255, 55, 183))
$g.DrawString("LS", $font, $shadowBrush, $cx + 3, $cy + 3, $sf)

$cyanBrush = New-Object System.Drawing.SolidBrush $cyan
$g.DrawString("LS", $font, $cyanBrush, $cx, $cy, $sf)

# Tiny shuffle/play indicator under the text
$smallFont = New-Object System.Drawing.Font("Consolas", [single]14, [System.Drawing.FontStyle]::Regular)
$smallBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 0, 216, 255))
$g.DrawString("SHUFFLE", $smallFont, $smallBrush, $cx, $size - 36, $sf)

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "wrote $out"
