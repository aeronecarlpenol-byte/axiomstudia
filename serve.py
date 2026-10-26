#!/usr/bin/env python3
"""
Axiom Studia — Local Development & Application Server
Serves the web application at http://localhost:3000 with proper MIME types.
"""

import http.server
import socketserver
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

PORT = 3000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = Path(DIRECTORY).resolve()

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        request_path = unquote(urlsplit(self.path).path)
        if request_path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return
        file_path = (APP_ROOT / request_path.lstrip('/')).resolve()
        relative = file_path.relative_to(APP_ROOT) if file_path.is_relative_to(APP_ROOT) else None
        allowed = request_path in ('/', '/index.html') or (
            relative is not None and len(relative.parts) == 2 and
            relative.parts[0] in ('css', 'js', 'assets') and
            relative.suffix.lower() in ('.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.webp')
        ) or (
            relative is not None and len(relative.parts) == 3 and
            relative.parts[0] == 'js' and relative.parts[1] == 'views' and relative.suffix.lower() == '.js'
        )
        if not allowed:
            self.send_error(404)
            return
        super().do_GET()

    def end_headers(self):
        # Enable CORS and disable aggressive caching for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

if __name__ == '__main__':
    # Ensure correct MIME type mappings for modern ES modules
    Handler.extensions_map.update({
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
    })

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"=======================================================")
        print(f"  Axiom Studia — Academic Operating System Server")
        print(f"  Application URL: http://localhost:{PORT}")
        print(f"  Serving Directory: {DIRECTORY}")
        print(f"  Press Ctrl+C to terminate the server.")
        print(f"=======================================================")
        sys.stdout.flush()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.shutdown()
