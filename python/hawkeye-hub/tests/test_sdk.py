import threading
from collections.abc import Mapping
from pathlib import Path

import pytest
from hawkeye_hub.testing import BackendFailed, run_backend

BACKEND = Path(__file__).parent / "backend"


def test_a_request_is_answered_with_its_camel_case_result(tmp_path: Path) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        result = backend.request("echo", {"text": "水印 ok", "repeatCount": 2})
        assert result == {"texts": ["水印 ok", "水印 ok"]}
        assert "a stray print goes to stderr" in backend.stderr


def test_a_handler_gets_what_initialize_sent(tmp_path: Path) -> None:
    stores = {"seating": tmp_path / "stores" / "seating"}
    with run_backend(
        BACKEND, data_dir=tmp_path / "data", stores=stores, hub_api="1.3.0"
    ) as backend:
        result = backend.request("started", {})
    assert result == {
        "dataDir": str(tmp_path / "data"),
        "stores": {"seating": str(stores["seating"])},
        "hubApi": "1.3.0",
    }


def test_a_notification_runs_its_handler(tmp_path: Path) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        backend.notify("ping", {"n": 1})
        assert backend.wait_for("pong", 1, timeout=5) == [{"n": 2}]


def test_a_notification_reaches_a_request_still_running(tmp_path: Path) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        answered = threading.Event()

        def wait() -> None:
            backend.request("waitForRelease", {})
            answered.set()

        waiter = threading.Thread(target=wait)
        waiter.start()
        assert not answered.wait(0.5)
        backend.notify("release", {})
        waiter.join(timeout=5)
        assert answered.is_set()


@pytest.mark.parametrize(
    "params",
    [{"text": 1, "repeatCount": 2}, {"text": "x"}, {"text": "x", "repeat_count": 2}],
    ids=["wrong type", "missing field", "snake_case name"],
)
def test_invalid_params_are_answered_with_invalid_params(
    tmp_path: Path, params: Mapping[str, object]
) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        with pytest.raises(BackendFailed) as failed:
            backend.request("echo", params)
    assert (failed.value.code, failed.value.reason) == (-32602, "invalid-params")


def test_an_rpc_error_is_answered_with_its_reason_and_message(tmp_path: Path) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        with pytest.raises(BackendFailed) as failed:
            backend.request("fail", {})
    assert (failed.value.reason, failed.value.message) == ("asked-to-fail", "Asked to fail")


def test_an_rpc_error_whose_reason_is_not_kebab_case_is_answered_with_internal(
    tmp_path: Path,
) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        with pytest.raises(BackendFailed) as failed:
            backend.request("failWithBadReason", {})
    assert (failed.value.code, failed.value.reason) == (-32603, "internal")
    assert "Asked To Fail" in failed.value.message


def test_a_hub_api_that_is_not_a_semantic_version_stops_the_backend(tmp_path: Path) -> None:
    with pytest.raises(AssertionError, match="exited before answering initialize"):
        with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="latest"):
            pass


def test_an_uncaught_exception_is_answered_with_internal_and_logs_its_traceback(
    tmp_path: Path,
) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        with pytest.raises(BackendFailed) as failed:
            backend.request("crash", {})
        assert (failed.value.code, failed.value.reason) == (-32603, "internal")
        assert "ValueError: a bug in the handler" in failed.value.message
        # It keeps serving.
        assert backend.request("echo", {"text": "a", "repeatCount": 1}) == {"texts": ["a"]}
    # stderr is read on its own thread, so it is complete only once the Backend has exited.
    assert "Traceback" in backend.stderr


def test_an_unknown_method_is_answered_with_method_not_found(tmp_path: Path) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        with pytest.raises(BackendFailed) as failed:
            backend.request("nope", {})
    assert (failed.value.code, failed.value.reason) == (-32601, "method-not-found")


def test_shutdown_runs_its_handler_then_exits(tmp_path: Path) -> None:
    # run_backend sends `shutdown` on exit, and fails if the Backend outlives the grace period.
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0"):
        pass
    assert (tmp_path / "data" / "shut-down").read_text(encoding="utf-8") == "✓"


def test_the_backend_exits_when_stdin_closes(tmp_path: Path) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        assert backend.close_stdin() == 0
    assert not (tmp_path / "data" / "shut-down").exists()
