"""Centralized GPU lifecycle helpers for the analyzer.

Every model load in the analyzer goes through ``gpu_model`` so its weights are
guaranteed to be evicted from VRAM regardless of how the call exits, and so the
VRAM cost of each phase is logged for visibility.
"""

from __future__ import annotations

import gc
from contextlib import contextmanager

import torch


def _cuda_available() -> bool:
    try:
        return torch.cuda.is_available()
    except Exception:
        return False


def _mps_available() -> bool:
    try:
        return torch.backends.mps.is_available()
    except Exception:
        return False


def vram_snapshot() -> dict:
    """Return current/peak GPU memory usage in MiB, or empty dict if neither CUDA nor MPS."""
    mib = 1024 * 1024
    if _cuda_available():
        try:
            torch.cuda.synchronize()
        except Exception:
            pass
        return {
            "allocated": torch.cuda.memory_allocated() // mib,
            "reserved": torch.cuda.memory_reserved() // mib,
            "peak_alloc": torch.cuda.max_memory_allocated() // mib,
            "peak_reserved": torch.cuda.max_memory_reserved() // mib,
        }
    if _mps_available():
        try:
            return {
                "allocated": torch.mps.current_allocated_memory() // mib,
                "reserved": torch.mps.driver_allocated_memory() // mib,
            }
        except Exception:
            pass
    return {}


def log_vram(tag: str) -> None:
    snap = vram_snapshot()
    if not snap:
        return
    parts = [f"{key}={value}MiB" for key, value in snap.items()]
    print(f"[nightingale:LOG] [vram:{tag}] " + " ".join(parts), flush=True)


def reset_peak_stats() -> None:
    if not _cuda_available():
        return
    try:
        torch.cuda.reset_peak_memory_stats()
    except Exception:
        pass


def hard_free_gpu(tag: str = "") -> None:
    """Aggressively free GPU memory: gc x2, sync, empty_cache, (ipc_collect on CUDA)."""
    for _ in range(2):
        gc.collect()
    if _cuda_available():
        try:
            torch.cuda.synchronize()
        except Exception:
            pass
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass
        try:
            torch.cuda.ipc_collect()
        except Exception:
            pass
    elif _mps_available():
        # MPS's caching allocator holds freed buffers until emptied; on Apple
        # Silicon's unified memory that cache shows up directly as process RSS.
        try:
            torch.mps.synchronize()
        except Exception:
            pass
        try:
            torch.mps.empty_cache()
        except Exception:
            pass
    if tag:
        log_vram(f"after_free:{tag}")


def move_to_cpu(model) -> None:
    """Best-effort eviction of model weights from VRAM to host RAM."""
    if model is None:
        return
    for attr in ("model", "model_run_obj", "separator"):
        inner = getattr(model, attr, None)
        if inner is not None and inner is not model:
            try:
                move_to_cpu(inner)
            except Exception:
                pass
    try:
        to = getattr(model, "to", None)
        if callable(to):
            to("cpu")
            return
    except Exception:
        pass
    try:
        cpu = getattr(model, "cpu", None)
        if callable(cpu):
            cpu()
    except Exception:
        pass


def release(model, name: str = "") -> None:
    """Move ``model`` to CPU, drop the reference, and free GPU memory."""
    try:
        move_to_cpu(model)
    except Exception:
        pass
    del model
    hard_free_gpu(name)


@contextmanager
def gpu_model(name: str):
    """Context manager that guarantees GPU cleanup for the model(s) it holds.

    Usage:
        with gpu_model("demucs") as held:
            model = load_demucs()
            held.append(model)
            ...

    On exit (success or exception), every model in ``held`` is moved to CPU,
    references are dropped, and GPU memory is forcibly reclaimed.
    """
    log_vram(f"before_load:{name}")
    holder: list = []
    try:
        yield holder
    finally:
        for m in holder:
            try:
                move_to_cpu(m)
            except Exception:
                pass
        holder.clear()
        hard_free_gpu(name)


def end_of_song_cleanup() -> None:
    """Best-effort full reset between queued songs.

    Calls into per-backend free hooks (kept for backwards compat) and then runs
    the bulletproof free pass. Safe to call repeatedly.
    """
    try:
        import parakeet
        parakeet.free_models()
    except Exception:
        pass
    hard_free_gpu("end_of_song")
