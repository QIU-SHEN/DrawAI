$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 256,256
$g = [Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([Drawing.Color]::FromArgb(255,38,38,38))
$pink = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255,236,127,164)),12
$light = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255,252,232,239)),9
$g.DrawPolygon($light, [Drawing.Point[]]@([Drawing.Point]::new(46,142),[Drawing.Point]::new(200,120),[Drawing.Point]::new(180,185),[Drawing.Point]::new(26,207)))
$g.DrawPolygon($pink, [Drawing.Point[]]@([Drawing.Point]::new(70,62),[Drawing.Point]::new(224,40),[Drawing.Point]::new(204,105),[Drawing.Point]::new(50,127)))
$buffer = New-Object IO.MemoryStream
$bitmap.Save($buffer, [Drawing.Imaging.ImageFormat]::Png)
$png = $buffer.ToArray()
$icon = [IO.File]::Create((Join-Path $PSScriptRoot '../desktop/icon.ico'))
$writer = New-Object IO.BinaryWriter $icon
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22)
$writer.Write($png); $writer.Dispose(); $buffer.Dispose(); $g.Dispose(); $pink.Dispose(); $light.Dispose(); $bitmap.Dispose()
