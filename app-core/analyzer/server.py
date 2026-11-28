#!/usr/bin/env python3
"""Persistent analyzer server for Nightingale.

Binds a TCP loopback socket and exchanges newline-delimited JSON with the
Rust client. Stdout/stderr are reserved for plain logs aside from one
handshake line emitted on startup.

Handshake (stdout, single line):
  {"event":"ready","port":N,"token":"...","device":"..."}

Wire protocol (NDJSON over TCP, one JSON object per line):
  Client -> server:
    {"type":"hello","token":"..."}
    {"type":"analyze","hash":"...","audio_path":"...","cache_path":"...", ...}
    {"type":"quit"}
  Server -> client:
    {"type":"hello_ack"}
    {"type":"progress","pct":N,"msg":"..."}
    {"type":"done","hash":"..."}
    {"type":"error","kind":"oom"|"generic","msg":"..."}

Stdin is not a command channel: the server exits when its parent dies.
"""

import json
import os
import secrets
import socket
import sys
import threading

if os.name == "nt":
    import huggingface_hub.file_download as _hf_dl
    _hf_dl.are_symlinks_supported = lambda *_a, **_kw: False

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gpu import end_of_song_cleanup, hard_free_gpu, log_vram, reset_peak_stats, vram_snapshot
from whisper_compat import detect_device, is_oom, set_align_backend, set_progress_sink
from audio import set_vocal_threshold_pct
from pipeline import run_pipeline


def process_song(cmd, device):
    audio_path = os.path.abspath(cmd["audio_path"])
    output_dir = os.path.abspath(cmd["cache_path"])
    file_hash = cmd["hash"]
    model_name = cmd.get("model", "large-v3")
    beam_size = cmd.get("beam_size", 8)
    batch_size = cmd.get("batch_size", 8)
    separator = cmd.get("separator", "karaoke")
    engine = cmd.get("engine", "whisper")
    lyrics_path = cmd.get("lyrics")
    language_override = cmd.get("language")
    skip_transcription = bool(cmd.get("skip_transcription", False))
    skip_separation = bool(cmd.get("skip_separation", False))

    set_align_backend(cmd.get("align_backend", "whisperx"))
    set_vocal_threshold_pct(cmd.get("vocal_detection_threshold_pct"))

    reset_peak_stats()
    log_vram("song_start")
    try:
        run_pipeline(
            audio_path, output_dir, file_hash, device,
            model_name=model_name,
            beam_size=beam_size,
            batch_size=batch_size,
            separator=separator,
            engine=engine,
            lyrics_path=lyrics_path,
            language_override=language_override,
            whisper_model=None,
            pre_align_cleanup=end_of_song_cleanup,
            free_gpu_fn=hard_free_gpu,
            skip_transcription=skip_transcription,
            skip_separation=skip_separation,
        )
    finally:
        end_of_song_cleanup()
        log_vram("song_end")


def _send(wfile, payload):
    try:
        wfile.write(json.dumps(payload, ensure_ascii=False) + "\n")
        wfile.flush()
    except (BrokenPipeError, OSError) as e:
        print(f"[nightingale:LOG] Failed to send message: {e}", file=sys.stderr, flush=True)
        os._exit(1)


SYNCHRONIZE = 0x00100000
WAIT_INFINITE = 0xFFFFFFFF


def _exit_with_parent():
    if os.name == "nt":
        # Waiting on the parent process keeps the inherited stdin pipe free: a
        # pending read on it blocks other users of that handle, and DLLs probing
        # the standard handles during load would deadlock on the loader lock.
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        parent = kernel32.OpenProcess(SYNCHRONIZE, False, os.getppid())
        if not parent:
            os._exit(0)
        kernel32.WaitForSingleObject(wintypes.HANDLE(parent), WAIT_INFINITE)
        os._exit(0)
    try:
        sys.stdin.buffer.read()
    finally:
        os._exit(0)


def main():
    threading.Thread(target=_exit_with_parent, daemon=True).start()
    device = detect_device()
    token = secrets.token_hex(16)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    print(
        json.dumps({"event": "ready", "port": port, "token": token, "device": device}),
        flush=True,
    )

    srv.settimeout(60.0)
    try:
        conn, _addr = srv.accept()
    except socket.timeout:
        print("[nightingale:LOG] Timed out waiting for client connection", file=sys.stderr, flush=True)
        return
    finally:
        srv.close()

    conn.settimeout(None)
    rfile = conn.makefile("r", encoding="utf-8", newline="\n")
    wfile = conn.makefile("w", encoding="utf-8", newline="\n")

    hello_line = rfile.readline()
    if not hello_line:
        return
    try:
        hello = json.loads(hello_line)
    except json.JSONDecodeError:
        return
    if hello.get("type") != "hello" or hello.get("token") != token:
        print("[nightingale:LOG] Auth failed, closing connection", file=sys.stderr, flush=True)
        return
    _send(wfile, {"type": "hello_ack"})

    set_progress_sink(lambda pct, msg: _send(wfile, {"type": "progress", "pct": int(pct), "msg": str(msg)}))

    try:
        for line in rfile:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError as e:
                _send(wfile, {"type": "error", "kind": "generic", "msg": f"Invalid JSON: {e}"})
                continue

            ctype = cmd.get("type")
            if ctype == "quit":
                break
            if ctype == "analyze":
                try:
                    process_song(cmd, device)
                    _send(wfile, {"type": "done", "hash": cmd.get("hash", "")})
                except Exception as e:
                    import traceback
                    traceback.print_exc(file=sys.stderr)
                    err_str = str(e)
                    if is_oom(err_str):
                        snap = vram_snapshot()
                        if snap:
                            print(
                                f"[nightingale:LOG] OOM in process_song; vram={snap}",
                                file=sys.stderr, flush=True,
                            )
                        end_of_song_cleanup()
                        _send(wfile, {"type": "error", "kind": "oom", "msg": err_str})
                    else:
                        _send(wfile, {"type": "error", "kind": "generic", "msg": err_str})
            else:
                _send(wfile, {"type": "error", "kind": "generic", "msg": f"Unknown command: {ctype!r}"})
    finally:
        try:
            wfile.close()
        except Exception:
            pass
        try:
            rfile.close()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
