# PROTOTYPE (#144): serves the repo root with caching off, so the page can load the real Hub Kit CSS
# from apps/hub/src/hub-kit and edits show on a plain reload. Run: python prototypes/plugin-switcher/serve.py
import functools
import http.server
import pathlib


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


root = pathlib.Path(__file__).resolve().parent.parent.parent
print("http://127.0.0.1:8138/prototypes/plugin-switcher/index.html", flush=True)
http.server.ThreadingHTTPServer(("127.0.0.1", 8138), functools.partial(NoCache, directory=root)).serve_forever()
