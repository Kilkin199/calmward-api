# ==== AJUSTA SOLO ESTO SI HACE FALTA ====
$projectRoot = "C:\dev\Calmward"
# =======================================

if (-not (Test-Path $projectRoot)) {
    Write-Host "La ruta $projectRoot no existe. Cámbiala arriba si tu proyecto está en otro sitio." -ForegroundColor Red
    exit 1
}

# Helper: escribir UTF-8 sin BOM
function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )
    $dir = Split-Path -Path $Path -Parent
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host "=== Intentando reparar textos de Calmward (mojibake UTF-8) ===" -ForegroundColor Cyan

# Encoding que suele dar lugar a "AsegÃºrate", "paÃ­s", etc.
$enc1252 = [System.Text.Encoding]::GetEncoding(1252)
$utf8    = New-Object System.Text.UTF8Encoding($false)

# Recorremos todos los .ts y .tsx dentro de src
Get-ChildItem -Path (Join-Path $projectRoot "src") -Recurse -Include *.ts,*.tsx |
    ForEach-Object {
        $path = $_.FullName
        $text = Get-Content $path -Raw

        # Reinterpretamos el texto: lo convertimos a bytes como si fuera 1252
        # y luego lo decodificamos como UTF-8.
        $bytes = $enc1252.GetBytes($text)
        $fixed = $utf8.GetString($bytes)

        if ($fixed -ne $text) {
            Write-Utf8NoBom -Path $path -Content $fixed
            Write-Host "Arreglado:" $path -ForegroundColor Green
        }
    }

Write-Host "=== Revisión terminada. Vuelve a ejecutar: npx expo start ===" -ForegroundColor Cyan
