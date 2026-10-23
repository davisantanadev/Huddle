# Instala (ou atualiza) o Eco a partir do servidor.
#
# Uso, no PowerShell:
#   irm https://129-159-51-96.sslip.io/download/install.ps1 | iex
#
# Baixa Eco.zip do servidor, confere o SHA-256 publicado ao lado, instala em
# %LOCALAPPDATA%\Eco (sem precisar de administrador), cria o atalho na Área de
# Trabalho e no Menu Iniciar e abre o app. Contas e configurações ficam em
# %APPDATA%\Eco e não são tocadas por uma atualização.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # a barra de progresso deixa o download muito lento no PowerShell 5

$base = "https://129-159-51-96.sslip.io/download"
$installDir = Join-Path $env:LOCALAPPDATA "Eco"
$zipPath = Join-Path $env:TEMP "Eco-download.zip"

Write-Host ""
Write-Host "  Eco - instalador" -ForegroundColor Cyan
Write-Host ""

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    Write-Host "  Baixando o Eco (cerca de 120 MB)..."
    Invoke-WebRequest -Uri "$base/Eco.zip" -OutFile $zipPath -UseBasicParsing
    $expected = ((Invoke-WebRequest -Uri "$base/Eco.zip.sha256" -UseBasicParsing).Content -split "\s+")[0].Trim().ToUpper()
    $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToUpper()
    if ($expected -ne $actual) {
        throw "O arquivo baixado não confere com o do servidor (download corrompido). Tente de novo."
    }

    # Atualização: fecha o Eco desta pasta antes de substituir os arquivos
    Get-Process -Name "Discord" -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) } |
        Stop-Process -Force
    Start-Sleep -Milliseconds 800

    Write-Host "  Instalando em $installDir ..."
    if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $installDir -Force
    Remove-Item $zipPath -Force

    $exe = Join-Path $installDir "Discord.exe"
    if (-not (Test-Path $exe)) { throw "Instalação incompleta: Discord.exe não encontrado." }

    $shell = New-Object -ComObject WScript.Shell
    $targets = @(
        (Join-Path ([Environment]::GetFolderPath("Desktop")) "Eco.lnk"),
        (Join-Path ([Environment]::GetFolderPath("Programs")) "Eco.lnk")
    )
    foreach ($lnkPath in $targets) {
        $lnk = $shell.CreateShortcut($lnkPath)
        $lnk.TargetPath = $exe
        $lnk.WorkingDirectory = $installDir
        $lnk.IconLocation = "$exe,0"
        $lnk.Description = "Eco"
        $lnk.Save()
    }

    Write-Host ""
    Write-Host "  Pronto! O atalho 'Eco' está na Área de Trabalho e no Menu Iniciar." -ForegroundColor Green
    Write-Host "  Abrindo o Eco..."
    Write-Host ""
    Start-Process -FilePath $exe -WorkingDirectory $installDir
}
catch {
    Write-Host ""
    Write-Host "  Não foi possível instalar: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force -ErrorAction SilentlyContinue }
}
