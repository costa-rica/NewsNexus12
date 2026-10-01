from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from src.modules.deduper.clear_control import (
    DeduperCancellationProgress,
    DeduperClearBusyError,
    DeduperClearControl,
    DeduperClearTimeoutError,
)
from src.modules.deduper.errors import DeduperConfigError
from src.modules.queue.engine import EnqueueJobInput, GlobalQueueEngine
from src.modules.queue.store import QueueJobStore
from src.modules.queue.types import QueueJobStatus


pytestmark = pytest.mark.unit
DEDUPER = "/deduper/start-job"


@pytest.fixture
def queue(tmp_path):
    store = QueueJobStore(tmp_path / "queue.json")
    return GlobalQueueEngine(store), store


def test_guard_rejects_concurrent_operation_and_releases_after_error(queue):
    engine, store = queue
    control = DeduperClearControl(engine, store, DEDUPER)

    def competing_operation():
        with control.exclusive_operation():
            pytest.fail("A competing operation entered the guard")

    with pytest.raises(RuntimeError, match="operation failed"):
        with control.exclusive_operation(), ThreadPoolExecutor(max_workers=1) as pool:
            with pytest.raises(DeduperClearBusyError):
                pool.submit(competing_operation).result(timeout=2)
            raise RuntimeError("operation failed")

    with control.exclusive_operation():
        pass


def test_mixed_queue_cancels_only_queued_deduper_without_waiting(queue):
    engine, store = queue
    started, release = Event(), Event()
    deduper_ran = Event()

    def unrelated_job(context):
        started.set()
        assert release.wait(timeout=5)

    active = engine.enqueue_job(EnqueueJobInput("/ai-approver-v02/start", unrelated_job))
    assert started.wait(timeout=2)
    first = engine.enqueue_job(EnqueueJobInput(DEDUPER, lambda _: deduper_ran.set()))
    second = engine.enqueue_job(
        EnqueueJobInput(DEDUPER, lambda _: deduper_ran.set(), {"reportId": 42})
    )
    other = engine.enqueue_job(EnqueueJobInput("/location-scorer/start-job", lambda _: None))
    control = DeduperClearControl(
        engine, store, DEDUPER, wait=lambda _: pytest.fail("Waited for unrelated work")
    )
    progress = DeduperCancellationProgress()
    try:
        with control.exclusive_operation():
            control.cancel_and_wait(progress)
        assert progress.cancelled_jobs == [first.jobId, second.jobId]
        assert progress.cancellation_requested_jobs == []
        assert store.get_job_by_id(active.jobId).status == QueueJobStatus.RUNNING
        assert store.get_job_by_id(other.jobId).status == QueueJobStatus.QUEUED
        assert not deduper_ran.is_set()
    finally:
        release.set()
        assert engine.on_idle(timeout=2)
    assert store.get_job_by_id(active.jobId).status == QueueJobStatus.COMPLETED
    assert store.get_job_by_id(other.jobId).status == QueueJobStatus.COMPLETED
    assert not deduper_ran.is_set()


def test_waits_for_running_handler_to_exit(queue):
    engine, store = queue
    started, cancel_seen, release, exited = Event(), Event(), Event(), Event()
    unrelated_started, unrelated_release = Event(), Event()

    def job(context):
        started.set()
        assert context.cancelEvent.wait(timeout=5)
        cancel_seen.set()
        assert release.wait(timeout=5)
        exited.set()

    target = engine.enqueue_job(EnqueueJobInput(DEDUPER, job))
    assert started.wait(timeout=2)

    def unrelated_job(context):
        unrelated_started.set()
        assert unrelated_release.wait(timeout=5)

    unrelated = engine.enqueue_job(
        EnqueueJobInput("/location-scorer/start-job", unrelated_job)
    )

    def finish_during_wait(seconds):
        assert cancel_seen.wait(timeout=2)
        assert not exited.is_set()
        assert store.get_job_by_id(target.jobId).status == QueueJobStatus.RUNNING
        release.set()
        assert unrelated_started.wait(timeout=2)

    control = DeduperClearControl(engine, store, DEDUPER, wait=finish_during_wait)
    progress = DeduperCancellationProgress()
    try:
        with control.exclusive_operation():
            control.cancel_and_wait(progress)
        assert exited.is_set()
        assert progress.cancellation_requested_jobs == [target.jobId]
        assert progress.cancelled_jobs == [target.jobId]
        assert engine.get_running_job_id() == unrelated.jobId
    finally:
        release.set()
        unrelated_release.set()
        assert engine.on_idle(timeout=2)


def test_timeout_keeps_requested_and_confirmed_cancellations_separate(queue, monkeypatch):
    monkeypatch.setenv("DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS", "1")
    engine, store = queue
    started, release = Event(), Event()
    time_now = [0.0]
    deletion_called = False

    def job(context):
        started.set()
        assert release.wait(timeout=5)

    active = engine.enqueue_job(EnqueueJobInput(DEDUPER, job))
    assert started.wait(timeout=2)
    queued = engine.enqueue_job(EnqueueJobInput(DEDUPER, lambda _: None))

    def advance_clock(seconds):
        time_now[0] += seconds

    control = DeduperClearControl(
        engine, store, DEDUPER, clock=lambda: time_now[0], wait=advance_clock
    )
    progress = DeduperCancellationProgress()
    try:
        with pytest.raises(DeduperClearTimeoutError, match="table was not cleared"):
            with control.exclusive_operation():
                control.cancel_and_wait(progress)
                deletion_called = True
        assert not deletion_called
        assert progress.cancellation_requested_jobs == [active.jobId]
        assert progress.cancelled_jobs == [queued.jobId]
        assert store.get_job_by_id(active.jobId).status == QueueJobStatus.RUNNING
        with control.exclusive_operation():
            pass
    finally:
        release.set()
        assert engine.on_idle(timeout=2)


def test_job_finishing_before_cancel_is_not_reported_as_canceled(queue, monkeypatch):
    engine, store = queue
    started, release = Event(), Event()

    def job(context):
        started.set()
        assert release.wait(timeout=5)

    target = engine.enqueue_job(EnqueueJobInput(DEDUPER, job))
    assert started.wait(timeout=2)
    original_cancel = engine.cancel_job

    def finish_before_cancel(job_id):
        release.set()
        assert engine.on_idle(timeout=2)
        return original_cancel(job_id)

    monkeypatch.setattr(engine, "cancel_job", finish_before_cancel)
    control = DeduperClearControl(engine, store, DEDUPER)
    progress = DeduperCancellationProgress()
    try:
        with control.exclusive_operation():
            control.cancel_and_wait(progress)
        assert progress.target_job_ids == [target.jobId]
        assert progress.cancelled_jobs == []
        assert progress.cancellation_requested_jobs == []
    finally:
        release.set()
        assert engine.on_idle(timeout=2)


def test_active_job_with_queued_record_is_canceled_and_waited_for(queue, monkeypatch):
    engine, store = queue
    selected, release = Event(), Event()
    handler_saw_cancel = Event()
    original_execute = engine._execute_job

    def delay_before_running_record(item, active):
        selected.set()
        assert release.wait(timeout=5)
        original_execute(item, active)

    monkeypatch.setattr(engine, "_execute_job", delay_before_running_record)

    def job(context):
        assert context.is_cancel_requested()
        handler_saw_cancel.set()

    target = engine.enqueue_job(EnqueueJobInput(DEDUPER, job))
    assert selected.wait(timeout=2)
    assert store.get_job_by_id(target.jobId).status == QueueJobStatus.QUEUED

    def allow_handler_to_run(seconds):
        assert not handler_saw_cancel.is_set()
        release.set()
        assert engine.on_idle(timeout=2)

    control = DeduperClearControl(engine, store, DEDUPER, wait=allow_handler_to_run)
    progress = DeduperCancellationProgress()
    try:
        with control.exclusive_operation():
            control.cancel_and_wait(progress)
        assert handler_saw_cancel.is_set()
        assert progress.cancellation_requested_jobs == [target.jobId]
        assert progress.cancelled_jobs == [target.jobId]
    finally:
        release.set()
        assert engine.on_idle(timeout=2)


def test_terminal_record_does_not_bypass_active_slot_check(queue, monkeypatch):
    engine, store = queue
    started, release_handler, terminal, release_slot = Event(), Event(), Event(), Event()
    original_execute = engine._execute_job

    def retain_active_slot(item, active):
        original_execute(item, active)
        terminal.set()
        assert release_slot.wait(timeout=5)

    monkeypatch.setattr(engine, "_execute_job", retain_active_slot)

    def job(context):
        started.set()
        assert release_handler.wait(timeout=5)

    target = engine.enqueue_job(EnqueueJobInput(DEDUPER, job))
    assert started.wait(timeout=2)
    waits = []

    def release_in_steps(seconds):
        waits.append(seconds)
        if len(waits) == 1:
            release_handler.set()
            assert terminal.wait(timeout=2)
            assert store.get_job_by_id(target.jobId).status == QueueJobStatus.CANCELED
        else:
            release_slot.set()
            assert engine.on_idle(timeout=2)

    control = DeduperClearControl(engine, store, DEDUPER, wait=release_in_steps)
    progress = DeduperCancellationProgress()
    try:
        with control.exclusive_operation():
            control.cancel_and_wait(progress)
        assert len(waits) == 2
        assert progress.cancelled_jobs == [target.jobId]
    finally:
        release_handler.set()
        release_slot.set()
        assert engine.on_idle(timeout=2)


def test_invalid_timeout_does_not_attempt_cancellation(queue, monkeypatch):
    engine, store = queue
    monkeypatch.setenv("DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS", "0")
    monkeypatch.setattr(engine, "cancel_job", lambda _: pytest.fail("Canceled before validation"))
    control = DeduperClearControl(engine, store, DEDUPER)
    with control.exclusive_operation(), pytest.raises(DeduperConfigError):
        control.cancel_and_wait(DeduperCancellationProgress())
