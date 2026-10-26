"""The `update` request over real stdio: every reason it can give without reaching Facebook."""

import threading
import time
from pathlib import Path

import pytest
from hawkeye_hub.testing import BackendFailed, run_backend

BACKEND = Path(__file__).parent.parent


def update(backend_dir: Path, data: Path, params: dict[str, object]) -> BackendFailed:
    with run_backend(backend_dir, data_dir=data, stores={}, hub_api="1.3.0") as backend:
        with pytest.raises(BackendFailed) as failed:
            backend.request("update", params)
    return failed.value


def params(output: Path, group: str = "460403882433823") -> dict[str, object]:
    return {"group": group, "output": str(output), "stopAtKnown": True}


def test_an_output_folder_that_is_gone_is_folder_missing(tmp_path: Path) -> None:
    failed = update(BACKEND, tmp_path / "data", params(tmp_path / "gone"))

    assert failed.reason == "folder-missing"


@pytest.mark.parametrize(
    "group",
    [
        "",
        "papers",
        "460403882433823x",
        "https://www.facebook.com/groups/some.vanity.name/",
        "https://example.com/groups/460403882433823",
    ],
)
def test_anything_but_a_group_url_or_bare_id_is_group_invalid(tmp_path: Path, group: str) -> None:
    failed = update(BACKEND, tmp_path / "data", params(tmp_path, group))

    assert failed.reason == "group-invalid"


def test_a_second_update_while_one_holds_edge_is_already_running(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A stand-in Playwright whose Edge launch waits for `release`: no run reaches Facebook.
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).parent / "fake_edge"))
    monkeypatch.setenv("FAKE_EDGE_DIR", str(tmp_path))
    answers: list[BaseException] = []
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:

        def first() -> None:
            try:
                backend.request("update", params(tmp_path))
            except BackendFailed as e:
                answers.append(e)

        thread = threading.Thread(target=first)
        thread.start()
        deadline = time.monotonic() + 30
        while not (tmp_path / "launched").exists() and time.monotonic() < deadline:
            time.sleep(0.05)

        with pytest.raises(BackendFailed) as failed:
            backend.request("update", params(tmp_path))
        (tmp_path / "release").touch()
        thread.join()

    assert failed.value.reason == "already-running"
    [launch_failed] = answers
    assert isinstance(launch_failed, BackendFailed)
    assert launch_failed.reason == "browser-not-found"


def test_params_it_does_not_know_are_invalid_params(tmp_path: Path) -> None:
    failed = update(BACKEND, tmp_path / "data", {**params(tmp_path), "maxPosts": 5})

    assert failed.reason == "invalid-params"
