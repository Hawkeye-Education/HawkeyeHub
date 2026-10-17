"""PROTOTYPE: play the Hub's side of the Backend contract and print every JSON-RPC line.

Run: python prototypes/pdf-watermark-eraser/_hub_stubs/drive_backend.py
Needs pymupdf in the current Python (the real Hub would build the venv with uv).
Spawns backend/main.py over stdio, sends `initialize`, then drives it the way the Plugin UI
would through hub.backend, and asserts the results.
"""
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import pymupdf

HERE = Path(__file__).parent
BACKEND = HERE.parent / "backend" / "main.py"


def make_pdfs(root: Path) -> None:
    def doc(path: Path, watermark: bool, **save):
        d = pymupdf.open()
        for i in range(3):
            page = d.new_page()
            page.insert_text((72, 100), f"Quarterly report page {i + 1}")
            if watermark:
                page.insert_text((100, 500), "Provided by dse.life", fontsize=40,
                                 morph=(pymupdf.Point(100, 500), pymupdf.Matrix(45)))
        path.parent.mkdir(parents=True, exist_ok=True)
        d.save(path, **save)

    doc(root / "marked.pdf", True)
    doc(root / "sub" / "marked2.pdf", True)
    doc(root / "clean.pdf", False)
    doc(root / "locked.pdf", True, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="x", owner_pw="x")


class Hub:
    def __init__(self, data_dir: Path):
        env = {**os.environ, "PYTHONPATH": str(HERE)}
        self.proc = subprocess.Popen([sys.executable, str(BACKEND)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     env=env, text=True, encoding="utf-8")
        self.inbox: queue.Queue = queue.Queue()
        self.next_id = 0
        threading.Thread(target=self._read, daemon=True).start()
        self.request("initialize", {"dataDir": str(data_dir), "stores": {}, "hubApi": "1.0.0"})

    def _read(self):
        for line in self.proc.stdout:
            print("  <-", line.rstrip())
            self.inbox.put(json.loads(line))

    def send(self, msg: dict):
        line = json.dumps({"jsonrpc": "2.0", **msg}, ensure_ascii=False)
        print("  ->", line)
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()

    def notify(self, method, params):
        self.send({"method": method, "params": params})

    def request(self, method, params, on_notification=lambda m: None) -> dict:
        self.next_id += 1
        self.send({"id": self.next_id, "method": method, "params": params})
        while True:
            msg = self.inbox.get(timeout=60)
            if msg.get("id") == self.next_id:
                return msg
            on_notification(msg)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        src, out = tmp / "in", tmp / "out"
        make_pdfs(src)
        hub = Hub(tmp / "plugin-data")

        print("\n# UI lists the input folder")
        r = hub.request("listPdfs", {"folder": str(src)})
        assert r["result"]["files"] == ["clean.pdf", "locked.pdf", "marked.pdf", "sub/marked2.pdf"], r

        print("\n# UI shows page 1 of a file so staff can copy its text to the Assistant")
        r = hub.request("pageText", {"folder": str(src), "file": "marked.pdf", "page": 0})
        assert "Provided by dse.life" in r["result"]["repeated"], r

        print("\n# a bad regex is rejected with a reason code, not English text")
        r = hub.request("run", {"input": str(src), "output": str(out), "pattern": "dse(",
                                "regex": True, "ignoreCase": True})
        assert r["error"]["data"]["reason"] == "pattern-invalid", r

        print("\n# a real run streams progress notifications")
        progress = []
        r = hub.request("run", {"input": str(src), "output": str(out), "pattern": r"Provided\s+by\s+dse\.life",
                                "regex": True, "ignoreCase": True}, progress.append)
        assert r["result"] == {"cleaned": 2, "failed": 2, "total": 4, "cancelled": False}, r
        kinds = {m["params"]["file"]: m["params"]["result"]["kind"] for m in progress}
        assert kinds == {"clean.pdf": "no-match", "locked.pdf": "password",
                         "marked.pdf": "cleaned", "sub/marked2.pdf": "cleaned"}, kinds
        assert (out / "sub" / "marked2.pdf").exists() and not (out / "clean.pdf").exists()
        with pymupdf.open(out / "marked.pdf") as d:
            assert "dse.life" not in d[0].get_text() and "Quarterly report" in d[0].get_text()

        print("\n# close: the Hub sends shutdown, then would kill the tree after ~5 s")
        hub.notify("shutdown", {})
        assert hub.proc.wait(timeout=5) == 0
        print("\nOK: Backend honours the contract")


if __name__ == "__main__":
    main()
