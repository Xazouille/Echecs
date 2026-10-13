<#
  Coup par Coup - serveur de fichiers local

  Ce script sert uniquement les fichiers du dossier docs/ a l'adresse http://localhost:8765.
  Il ne telecharge rien et n'accepte que les connexions de cet ordinateur.
  Les parties sont recuperees par le navigateur, directement sur l'API publique de Chess.com.

  Un navigateur ne peut pas faire tourner Stockfish depuis un simple fichier ouvert
  par double-clic, d'ou ce petit serveur.

  Usage : powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1 [-Port 8765] [-NoBrowser]
#>
param(
  [int]$Port = 8765,
  [switch]$NoBrowser
)

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'docs'))

$Types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.wasm' = 'application/wasm'
  '.svg'  = 'image/svg+xml'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.txt'  = 'text/plain; charset=utf-8'
}

function Send-File($ctx) {
  $res = $ctx.Response
  try {
    # Isolation de la page : permet a Stockfish d'utiliser plusieurs coeurs quand le navigateur l'accepte.
    $res.Headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    $res.Headers['Cross-Origin-Embedder-Policy'] = 'credentialless'

    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $Root $path.TrimStart('/')))

    if (-not $file.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('Fichier introuvable')
      $res.ContentType = 'text/plain; charset=utf-8'
    } else {
      $type = $Types[[IO.Path]::GetExtension($file).ToLower()]
      if (-not $type) { $type = 'application/octet-stream' }
      $res.ContentType = $type
      $res.Headers['Cache-Control'] = 'no-cache'
      $bytes = [IO.File]::ReadAllBytes($file)
    }
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    Write-Host "Erreur : $($_.Exception.Message)"
  } finally {
    try { $res.Close() } catch { }
  }
}

$listener = $null
foreach ($p in $Port..($Port + 10)) {
  try {
    $l = New-Object Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $Port = $p
    break
  } catch { }
}
if (-not $listener) {
  Write-Host "Aucun port libre entre $Port et $($Port + 10)."
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host "  Coup par Coup est ouvert sur $url"
Write-Host '  Laisse cette fenetre ouverte pendant que tu utilises le site.'
Write-Host '  Pour arreter : ferme cette fenetre.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $wait = $listener.BeginGetContext($null, $null)
    while (-not $wait.AsyncWaitHandle.WaitOne(300)) { }
    Send-File ($listener.EndGetContext($wait))
  }
} finally {
  $listener.Close()
}
