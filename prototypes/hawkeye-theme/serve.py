# PROTOTYPE: serves prototypes/ with caching off, so edits show on a plain reload. Run: python prototypes/hawkeye-theme/serve.py
import functools
import http.server
import pathlib


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


root = pathlib.Path(__file__).resolve().parent.parent
print("http://127.0.0.1:8137/hawkeye-theme/index.html", flush=True)
http.server.ThreadingHTTPServer(("127.0.0.1", 8137), functools.partial(NoCache, directory=root)).serve_forever()
