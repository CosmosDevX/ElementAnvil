Add-Type -AssemblyName System.Drawing
$iconRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\build'))
New-Item -ItemType Directory -Path $iconRoot -Force | Out-Null
$bitmap = New-Object Drawing.Bitmap(256,256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.ColorTranslator]::FromHtml('#101916'))
$pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#88bd86'),15)
$pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawLines($pen, [Drawing.Point[]]@((New-Object Drawing.Point(81,70)),(New-Object Drawing.Point(35,128)),(New-Object Drawing.Point(81,186))))
$graphics.DrawLines($pen, [Drawing.Point[]]@((New-Object Drawing.Point(175,70)),(New-Object Drawing.Point(221,128)),(New-Object Drawing.Point(175,186))))
$brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#d5e7c5'))
$graphics.FillPolygon($brush,[Drawing.Point[]]@((New-Object Drawing.Point(136,55)),(New-Object Drawing.Point(101,160)),(New-Object Drawing.Point(128,145)),(New-Object Drawing.Point(121,201)),(New-Object Drawing.Point(158,90)),(New-Object Drawing.Point(129,107))))
$eyePen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#101916'),7)
$graphics.DrawLine($eyePen,105,120,114,120)
$graphics.DrawLine($eyePen,137,120,146,120)
$pngPath = Join-Path $iconRoot 'icon.png'
$bitmap.Save($pngPath,[Drawing.Imaging.ImageFormat]::Png)
$png = [IO.File]::ReadAllBytes($pngPath)
$stream = [IO.File]::Create((Join-Path $iconRoot 'icon.ico'))
$writer = New-Object IO.BinaryWriter($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $pen.Dispose(); $eyePen.Dispose(); $brush.Dispose()
