# Instala (ou atualiza) o Invadominio zak' zak a partir do servidor.
#
# Uso, no PowerShell:
#   irm https://129-159-51-96.sslip.io/download/install.ps1 | iex
#
# Baixa Eco.zip do servidor, confere o SHA-256 publicado ao lado, instala em
# %LOCALAPPDATA%\Invadominio (sem precisar de administrador), cria o atalho na
# Área de Trabalho e no Menu Iniciar e abre o app. Contas e configurações
# ficam em %APPDATA%\Eco e não são tocadas por uma atualização. Instalações
# antigas (com o nome "Eco") são fechadas e removidas.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # a barra de progresso deixa o download muito lento no PowerShell 5

$appName = "Invadominio zak' zak"
$base = "https://129-159-51-96.sslip.io/download"
$installDir = Join-Path $env:LOCALAPPDATA "Invadominio"
$oldInstallDir = Join-Path $env:LOCALAPPDATA "Eco"
$zipPath = Join-Path $env:TEMP "Invadominio-download.zip"
$desktop = [Environment]::GetFolderPath("Desktop")
$programs = [Environment]::GetFolderPath("Programs")

Write-Host ""
Write-Host "  $appName - instalador" -ForegroundColor Cyan
Write-Host ""

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    Write-Host "  Baixando o $appName (cerca de 120 MB)..."
    Invoke-WebRequest -Uri "$base/Eco.zip" -OutFile $zipPath -UseBasicParsing
    $expected = ((Invoke-WebRequest -Uri "$base/Eco.zip.sha256" -UseBasicParsing).Content -split "\s+")[0].Trim().ToUpper()
    $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToUpper()
    if ($expected -ne $actual) {
        throw "O arquivo baixado não confere com o do servidor (download corrompido). Tente de novo."
    }

    # Atualização: fecha o app (versão nova ou antiga "Eco") antes de substituir os arquivos
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and ($_.Path.StartsWith($installDir + "\", [StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith($oldInstallDir + "\", [StringComparison]::OrdinalIgnoreCase)) } |
        Stop-Process -Force
    Start-Sleep -Milliseconds 1200

    Write-Host "  Instalando em $installDir ..."
    if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $installDir -Force
    Remove-Item $zipPath -Force

    $exe = Join-Path $installDir "$appName.exe"
    if (-not (Test-Path -LiteralPath $exe)) { throw "Instalação incompleta: $appName.exe não encontrado." }

    # Restos da versão com o nome antigo
    if (Test-Path $oldInstallDir) { Remove-Item $oldInstallDir -Recurse -Force -ErrorAction SilentlyContinue }
    foreach ($old in @((Join-Path $desktop "Eco.lnk"), (Join-Path $programs "Eco.lnk"))) {
        if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
    }

    $shell = New-Object -ComObject WScript.Shell
    foreach ($lnkPath in @((Join-Path $desktop "$appName.lnk"), (Join-Path $programs "$appName.lnk"))) {
        $lnk = $shell.CreateShortcut($lnkPath)
        $lnk.TargetPath = $exe
        $lnk.WorkingDirectory = $installDir
        $lnk.IconLocation = "$exe,0"
        $lnk.Description = $appName
        $lnk.Save()
    }

    Write-Host ""
    Write-Host "  Pronto! O atalho '$appName' está na Área de Trabalho e no Menu Iniciar." -ForegroundColor Green
    Write-Host "  Abrindo o $appName..."
    Write-Host ""
    Start-Process -FilePath $exe -WorkingDirectory $installDir
}
catch {
    Write-Host ""
    Write-Host "  Não foi possível instalar: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force -ErrorAction SilentlyContinue }
}
