#!/bin/sh
# Coup par Coup - lanceur pour macOS.
# Double-clic (apres un premier « chmod +x », voir README.md) ou, dans le Terminal :
#   sh Lancer-Mac.command

cd "$(dirname "$0")" || exit 1

if [ ! -f "serveur-mac.pl" ] || [ ! -f "docs/index.html" ]; then
  echo ""
  echo "  Il manque des fichiers a cote de Lancer-Mac.command (serveur-mac.pl ou le dossier docs)."
  echo "  Si tu as telecharge un .zip : double-clique dessus pour l'extraire,"
  echo "  puis relance depuis le dossier extrait."
  echo ""
  echo "  Dossier actuel : $(pwd)"
  exit 1
fi

if command -v perl >/dev/null 2>&1; then
  exec perl serveur-mac.pl "$@"
fi

echo ""
echo "  Perl est introuvable sur ce Mac : impossible de lancer le serveur local."
echo "  Envoie ce message pour qu'une autre solution soit mise en place."
exit 1
