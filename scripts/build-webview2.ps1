$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdkVersion = '1.0.4314.35'
$sdkRoot = Join-Path $repo '.local/webview2-sdk/package'
$output = Join-Path $repo 'releases/DrawAI-WebView2-0.6.0-win-x64'
$web = Join-Path $output 'web'
$temporary = Join-Path $repo '.local/webview2-build-temp'
New-Item -ItemType Directory -Force -Path $output,$web,(Join-Path $web 'src'),(Join-Path $web 'native'),$temporary | Out-Null
$env:TEMP = $temporary; $env:TMP = $temporary
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'lib/net462/Microsoft.Web.WebView2.Core.dll'))) {
    $zip = Join-Path $repo '.local/webview2-sdk/package.zip'
    New-Item -ItemType Directory -Force -Path (Split-Path $zip) | Out-Null
    & curl.exe -f -L --retry 2 --silent --show-error "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -o $zip
    if ($LASTEXITCODE -ne 0) { throw 'WebView2 SDK download failed' }
    Expand-Archive -LiteralPath $zip -DestinationPath $sdkRoot -Force
}
$utf8 = New-Object Text.UTF8Encoding $false
$html = [IO.File]::ReadAllText((Join-Path $repo 'index.html')).Replace('src="/src/app.js"','src="/native/loader.js"')
[IO.File]::WriteAllText((Join-Path $web 'index.html'),$html,$utf8)
foreach ($asset in @('app.js','model.js','scene.js','styles.css','portable.json')) {
    Copy-Item -LiteralPath (Join-Path $repo "src/$asset") -Destination (Join-Path $web "src/$asset")
}
Copy-Item -LiteralPath (Join-Path $repo 'desktop-webview/loader.js') -Destination (Join-Path $web 'native/loader.js')
Copy-Item -LiteralPath (Join-Path $repo 'desktop/icon.ico') -Destination (Join-Path $output 'icon.ico')
foreach ($dll in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $sdkRoot "lib/net462/$dll") -Destination (Join-Path $output $dll)
}
Copy-Item -LiteralPath (Join-Path $sdkRoot 'runtimes/win-x64/native/WebView2Loader.dll') -Destination (Join-Path $output 'WebView2Loader.dll')
Copy-Item -LiteralPath (Join-Path $sdkRoot 'LICENSE.txt') -Destination (Join-Path $output 'WebView2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $sdkRoot 'NOTICE.txt') -Destination (Join-Path $output 'WebView2-NOTICE.txt')
Copy-Item -LiteralPath (Join-Path $repo 'desktop-webview/使用说明.txt') -Destination (Join-Path $output '使用说明.txt')
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$visualBasic = Get-ChildItem (Join-Path $env:WINDIR 'Microsoft.NET/assembly/GAC_MSIL/Microsoft.VisualBasic') -Recurse -Filter Microsoft.VisualBasic.dll | Select-Object -First 1 -ExpandProperty FullName
$compilerArgs = @('/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output',('/out:' + (Join-Path $output 'DrawAI-WebView2.exe')),('/win32icon:' + (Join-Path $output 'icon.ico')),('/reference:' + $visualBasic),'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',('/reference:' + (Join-Path $output 'Microsoft.Web.WebView2.Core.dll')),('/reference:' + (Join-Path $output 'Microsoft.Web.WebView2.WinForms.dll')),(Join-Path $repo 'desktop-webview/Program.cs'))
& (Join-Path $framework 'csc.exe') @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'WebView2 host compilation failed' }
[IO.File]::WriteAllText((Join-Path $output 'DrawAI-WebView2.exe.config'), '<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.6.2"/></startup></configuration>', $utf8)
# Explicit archive allowlist excludes the data directory from previous test runs.
$archive = Join-Path $repo 'releases/DrawAI-WebView2-0.6.0-Windows-x64.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
$stream = [IO.File]::Open($archive,[IO.FileMode]::CreateNew)
$zipWriter = New-Object IO.Compression.ZipArchive $stream,([IO.Compression.ZipArchiveMode]::Create)
try {
    $files = @('DrawAI-WebView2.exe','DrawAI-WebView2.exe.config','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','icon.ico','WebView2-LICENSE.txt','WebView2-NOTICE.txt','使用说明.txt','web/index.html','web/native/loader.js','web/src/app.js','web/src/model.js','web/src/scene.js','web/src/styles.css','web/src/portable.json')
    foreach ($file in $files) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipWriter,(Join-Path $output $file),('DrawAI-WebView2/' + $file),[IO.Compression.CompressionLevel]::Optimal) | Out-Null }
} finally { $zipWriter.Dispose(); $stream.Dispose() }
Get-Item -LiteralPath $archive | Select-Object FullName,Length
