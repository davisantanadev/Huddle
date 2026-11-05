# Instala (ou atualiza) o Huddle a partir do servidor.
# (Quem prefere não usar comando baixa o instalador com janela: /download/Instalar-Huddle.exe)
#
# Uso, no PowerShell:
#   irm https://129-159-51-96.sslip.io/download/install.ps1 | iex
#
# Confere a assinatura oficial do pacote, baixa Eco.zip e confere o SHA-256, instala em
# %LOCALAPPDATA%\Huddle (sem precisar de administrador), cria o atalho na
# Área de Trabalho e no Menu Iniciar e abre o app. Contas e configurações
# ficam em %APPDATA%\Eco e não são tocadas por uma atualização. Instalações
# antigas (com o nome "Eco") são fechadas e removidas.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # a barra de progresso deixa o download muito lento no PowerShell 5

$appName = "Huddle"
$oldAppName = "Invadominio zak' zak"
$base = "https://129-159-51-96.sslip.io/download"
$installDir = Join-Path $env:LOCALAPPDATA "Huddle"
# Quem instalou antes da troca de nome continua na mesma pasta
$renamedDir = Join-Path $env:LOCALAPPDATA "Invadominio"
if ((Test-Path $renamedDir) -and -not (Test-Path $installDir)) { $installDir = $renamedDir }
$oldInstallDir = Join-Path $env:LOCALAPPDATA "Eco"
$zipPath = Join-Path $env:TEMP "Huddle-download.zip"
$desktop = [Environment]::GetFolderPath("Desktop")
$programs = [Environment]::GetFolderPath("Programs")

Write-Host ""
Write-Host "  $appName - instalador" -ForegroundColor Cyan
Write-Host ""

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    # Assinatura oficial: o manifesto (versão, tamanho e SHA-256 do pacote) é
    # assinado com uma chave que nunca fica no servidor. Sem assinatura válida,
    # nada é instalado. Mesma chave de electron/updateSignature.js.
    $manifestBytes = (Invoke-WebRequest -Uri "$base/manifest.json" -UseBasicParsing).RawContentStream.ToArray()
    $signature = [Convert]::FromBase64String(((Invoke-WebRequest -Uri "$base/manifest.sig" -UseBasicParsing).Content).Trim())
    $params = New-Object System.Security.Cryptography.ECParameters
    $params.Curve = [System.Security.Cryptography.ECCurve+NamedCurves]::nistP256
    $point = New-Object System.Security.Cryptography.ECPoint
    $point.X = [Convert]::FromBase64String("LsNkEIar9FnMrqzQ4PPBKGBOU+ppnfco8GCfNpoaLnA=")
    $point.Y = [Convert]::FromBase64String("+cwmOWJgflIBPzXm51zlMxAAcMCTMRQxFR3byXQ79ZY=")
    $params.Q = $point
    $ecdsa = [System.Security.Cryptography.ECDsa]::Create($params)
    if ($signature.Length -ne 64 -or -not $ecdsa.VerifyData($manifestBytes, $signature, [System.Security.Cryptography.HashAlgorithmName]::SHA256)) {
        throw "O pacote do servidor não tem a assinatura oficial do $appName. Nada foi instalado."
    }
    $manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json

    Write-Host "  Baixando o $appName $($manifest.version) (cerca de 120 MB)..."
    Invoke-WebRequest -Uri "$base/Eco.zip" -OutFile $zipPath -UseBasicParsing
    $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne ([string]$manifest.sha256).ToLower() -or (Get-Item $zipPath).Length -ne [long]$manifest.size) {
        throw "O arquivo baixado não confere com o pacote assinado (download corrompido ou alterado). Tente de novo."
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
    foreach ($old in @((Join-Path $desktop "Eco.lnk"), (Join-Path $programs "Eco.lnk"), (Join-Path $desktop "$oldAppName.lnk"), (Join-Path $programs "$oldAppName.lnk"))) {
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
