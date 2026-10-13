#!/usr/bin/perl
# Coup par Coup - serveur de fichiers local pour macOS (Perl est fourni avec macOS).
#
# Equivalent de server.ps1 sous Windows : il sert uniquement les fichiers du dossier
# docs/ a l'adresse http://localhost:8765, n'accepte que les connexions de ce Mac
# et ne telecharge rien. Les parties sont recuperees par le navigateur sur Chess.com.
#
# Usage : perl serveur-mac.pl [--no-browser]

use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;
use Cwd qw(abs_path);
use File::Basename qw(dirname);

$SIG{PIPE} = 'IGNORE';

my $root = abs_path(dirname(abs_path($0)) . '/docs');
die "Dossier docs/ introuvable a cote de serveur-mac.pl.\n" unless $root && -d $root;

my %types = (
  html => 'text/html; charset=utf-8',
  js   => 'text/javascript; charset=utf-8',
  css  => 'text/css; charset=utf-8',
  wasm => 'application/wasm',
  svg  => 'image/svg+xml',
  json => 'application/json; charset=utf-8',
  png  => 'image/png',
  txt  => 'text/plain; charset=utf-8',
);

my ($server, $port);
for my $p (8765 .. 8775) {
  $server = IO::Socket::INET->new(
    LocalAddr => '127.0.0.1',
    LocalPort => $p,
    Proto     => 'tcp',
    Listen    => 20,
    ReuseAddr => 1,
  );
  if ($server) { $port = $p; last; }
}
die "Aucun port libre entre 8765 et 8775.\n" unless $server;

my $url = "http://localhost:$port/";
print "\n  Coup par Coup est ouvert sur $url\n";
print "  Laisse cette fenetre ouverte pendant que tu utilises le site.\n";
print "  Pour arreter : ferme cette fenetre (ou Ctrl+C).\n\n";
system('open', $url) unless grep { $_ eq '--no-browser' } @ARGV;

sub reply {
  my ($client, $status, $type, $body, $head_only) = @_;
  print $client "HTTP/1.1 $status\r\n"
    . "Content-Type: $type\r\n"
    . "Content-Length: " . length($body) . "\r\n"
    . "Cache-Control: no-cache\r\n"
    . "Cross-Origin-Opener-Policy: same-origin\r\n"
    . "Cross-Origin-Embedder-Policy: credentialless\r\n"
    . "Connection: close\r\n\r\n";
  print $client $body unless $head_only;
}

while (my $client = $server->accept) {
  binmode $client;
  # Un navigateur peut ouvrir une connexion « d'avance » sans rien envoyer : on ne l'attend pas.
  unless (IO::Select->new($client)->can_read(3)) { close $client; next; }
  my $request = <$client>;
  while (defined(my $line = <$client>)) { last if $line =~ /^\r?\n$/; }

  if (!defined $request || $request !~ m{^(GET|HEAD) (\S+)}) {
    reply($client, '400 Bad Request', 'text/plain; charset=utf-8', 'Requete invalide', 0);
    close $client;
    next;
  }
  my ($method, $target) = ($1, $2);
  $target =~ s/[?#].*//;
  $target =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
  $target = '/index.html' if $target eq '/';

  my $file = abs_path($root . $target);
  if (!defined $file || index($file, "$root/") != 0 || !-f $file) {
    reply($client, '404 Not Found', 'text/plain; charset=utf-8', 'Fichier introuvable', $method eq 'HEAD');
    close $client;
    next;
  }

  my $body = '';
  if (open(my $fh, '<:raw', $file)) {
    local $/;
    $body = <$fh>;
    close $fh;
  }
  my ($ext) = $file =~ /\.([^.\/]+)$/;
  my $type = $types{ lc($ext // '') } // 'application/octet-stream';
  reply($client, '200 OK', $type, $body, $method eq 'HEAD');
  close $client;
}
