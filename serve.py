"""Local server for Somnus that disables caching, so code changes always load."""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f'Somnus running at http://localhost:{port}  (Ctrl+C to stop)')
    http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
