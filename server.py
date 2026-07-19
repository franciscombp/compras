#!/usr/bin/env python3
"""
Servidor HTTPS de desarrollo para Quanto.

- Sirve la app en https://localhost:4443 con los certificados mkcert
  (localhost.pem / localhost-key.pem) para que getUserMedia (cámara) y
  SpeechRecognition funcionen en un contexto seguro.
- Envía Cache-Control: no-store para que el navegador nunca use caché
  y siempre veas la última versión de index.html / app.js / tokens.css.
- Nunca sirve los certificados ni archivos ocultos.

Uso:  python3 server.py
"""

import http.server
import socket
import socketserver
import ssl
import sys
from pathlib import Path

PORT = 4443
ROOT = Path(__file__).resolve().parent
CERT = ROOT / "localhost.pem"
KEY = ROOT / "localhost-key.pem"

BLOQUEADOS = (".pem", ".key", ".crt", ".p12")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Sin caché: el objetivo de este servidor es ver siempre lo último.
        self.send_header("Cache-Control", "no-store, max-age=0, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def send_head(self):
        ruta = self.path.split("?")[0]
        nombre = ruta.rsplit("/", 1)[-1]
        if nombre.startswith(".") or nombre.lower().endswith(BLOQUEADOS):
            self.send_error(404, "No encontrado")
            return None
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("[quanto] %s\n" % (fmt % args))


def ip_local():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def main():
    if not CERT.exists() or not KEY.exists():
        sys.exit(
            "Faltan certificados. Genera con:\n"
            "  mkcert localhost 127.0.0.1 ::1\n"
            f"y deja localhost.pem / localhost-key.pem en {ROOT}"
        )

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT), keyfile=str(KEY))

    class Servidor(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    with Servidor(("0.0.0.0", PORT), Handler) as httpd:
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        print(f"Quanto en https://localhost:{PORT}")
        ip = ip_local()
        if ip:
            print(f"En tu red local: https://{ip}:{PORT}")
            print(
                "(para probar desde el teléfono sin aviso de seguridad, "
                f"regenera el certificado incluyendo esa IP: mkcert localhost 127.0.0.1 ::1 {ip})"
            )
        httpd.serve_forever()


if __name__ == "__main__":
    main()
