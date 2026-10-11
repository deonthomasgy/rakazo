#!/lsiopy/bin/python
"""Docker screen transport. Private displays and control leases share one gateway."""

import argparse
import asyncio
import contextlib
import fcntl
import json
import itertools
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.request

from aiohttp import ClientSession, TCPConnector, WSMsgType, web

ROOT = Path("/tmp/rakazo")
TARGETS = ROOT / "desktop-targets"
WEB = Path("/usr/share/selkies/web")
HELPER = "/usr/local/bin/rakazo-stream-screen"
LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".next")
    temporary.write_text(content)
    temporary.chmod(0o600)
    temporary.replace(path)


def state_path(display):
    return ROOT / f"stream-{display}.json"


def read_state(display):
    try:
        return json.loads(state_path(display).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def running(pid, marker):
    try:
        args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        return marker.encode() in args
    except (FileNotFoundError, ProcessLookupError):
        return False


@contextlib.contextmanager
def locked(name):
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / f"{name}.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def token_permissions(state):
    result = {state["view"]: {"role": "viewer"}}
    if state.get("driver"):
        result[state["driver"]] = {"role": "controller"}
    if state.get("control"):
        result[state["control"]] = {"role": "controller", "mk_control": True}
    return result


def configure(state, permissions=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{state['control_port']}/tokens",
        data=json.dumps(token_permissions(state) if permissions is None else permissions).encode(),
        headers={"Authorization": f"Bearer {state['master']}", "Content-Type": "application/json"},
        method="POST",
    )
    with LOCAL_HTTP.open(request, timeout=2) as response:
        if response.status != 200:
            raise RuntimeError("screen permission update failed")


def publish(display, state):
    # These are the same private mapping files used by the terminal transport.
    for kind in ("view", "control"):
        token = state.get(kind)
        atomic_write(TARGETS / f"{kind}-{display}", f"{token}: screen:{display}\n" if token else "")
    control = ROOT / f"control-token-{display}"
    if state.get("control"):
        atomic_write(control, state["control"])
    else:
        control.unlink(missing_ok=True)
    atomic_write(state_path(display), json.dumps(state))


def free_ports():
    with socket.socket() as first, socket.socket() as second:
        first.bind(("127.0.0.1", 0))
        second.bind(("127.0.0.1", 0))
        return first.getsockname()[1], second.getsockname()[1]


def ensure(display, token):
    with locked(f"stream-{display}"):
        state = read_state(display)
        if state and running(state["pid"], HELPER):
            if state["view"] != token:
                state["view"] = token
                configure(state)
                publish(display, state)
            return
        port, control_port = free_ports()
        state = {"port": port, "control_port": control_port, "master": secrets.token_urlsafe(32), "driver": secrets.token_urlsafe(32), "view": token}
        runtime = ROOT / f"runtime-{display}"
        runtime.mkdir(mode=0o700, exist_ok=True)
        environment = {key: value for key, value in os.environ.items() if not key.startswith("SELKIES_")}
        environment.pop("WAYLAND_DISPLAY", None)
        environment.update(DISPLAY=f":{display}", XDG_RUNTIME_DIR=str(runtime), PIXELFLUX_WAYLAND="false")
        # Secure mode validates each token and enforces viewer/controller input permissions.
        command = [
            sys.executable, HELPER, "worker", "--mode", "websockets", "--port", str(port),
            "--control-port", str(control_port), "--master-token", state["master"],
            "--encoder", "x264enc", "--use-cpu", "true", "--framerate", "30",
            "--manual-width", "1280", "--manual-height", "800",
            "--audio-enabled", "false|locked", "--microphone-enabled", "false|locked",
            "--gamepad-enabled", "false|locked", "--command-enabled", "false|locked",
            "--enable-sharing", "false|locked", "--enable-dual-mode", "false|locked",
            "--second-screen", "false|locked", "--ui-show-sidebar", "false|locked",
            "--ui-show-logo", "false|locked", "--ui-show-core-buttons", "false|locked",
        ]
        with (ROOT / f"stream-{display}.log").open("ab") as log:
            process = subprocess.Popen(command, env=environment, stdout=log, stderr=log, start_new_session=True)
        state["pid"] = process.pid
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("screen streamer exited during startup")
                try:
                    configure(state)
                    publish(display, state)
                    return
                except (OSError, urllib.error.URLError):
                    time.sleep(0.1)
            raise RuntimeError("screen streamer did not become ready")
        except BaseException:
            process.terminate()
            process.wait(timeout=5)
            raise


def control(display, token, revoke=False):
    with locked(f"stream-{display}"):
        state = read_state(display)
        if not state:
            if revoke:
                return
            raise RuntimeError("screen is not running")
        if revoke and token and state.get("control") != token:
            return  # A stale lease must never revoke a newer controller.
        previous = state.get("control")
        state["control"] = None if revoke else token
        if state.get("control") == previous:
            return
        configure(state)
        publish(display, state)
        if revoke:
            print("RAKAZO_CONTROL_RELEASED")


def stop(display):
    with locked(f"stream-{display}"):
        state = read_state(display)
        for kind in ("view", "control"):
            atomic_write(TARGETS / f"{kind}-{display}", "")
        if state and running(state["pid"], HELPER):
            with contextlib.suppress(OSError):
                configure(state, {})
            os.kill(state["pid"], signal.SIGTERM)
            for _ in range(50):
                if not running(state["pid"], HELPER):
                    break
                time.sleep(0.1)
            if running(state["pid"], HELPER):
                os.kill(state["pid"], signal.SIGKILL)
        state_path(display).unlink(missing_ok=True)
        (ROOT / f"control-token-{display}").unlink(missing_ok=True)


def resolve_token(token):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", token):
        return None
    for path in TARGETS.glob("*"):
        if not re.fullmatch(r"(?:view|control|terminal)-[0-9]+", path.name):
            continue
        try:
            for line in path.read_text().splitlines():
                key, separator, target = line.partition(": ")
                if separator and secrets.compare_digest(key, token):
                    return target
        except FileNotFoundError:
            continue
    return None


def public_message(message):
    if message.startswith("{"):
        payload = json.loads(message)
        if payload.get("type") == "server_settings":
            for key in ("master_token", "control_port", "recording_socket"):
                payload["settings"].pop(key, None)
            return json.dumps(payload)
    return message


async def drive_stream(display, state, driver):
    # Selkies requires a primary display client even for view-only streams.
    # Keep that private client independent of human connections and control handoffs.
    async with ClientSession(connector=TCPConnector(local_addr=("127.0.0.2", 0))) as session:
        while (read_state(display) or {}).get("pid") == state["pid"]:
            try:
                async with session.ws_connect(f"http://127.0.0.1:{state['port']}/?token={state['driver']}", max_msg_size=16 * 1024 * 1024) as websocket:
                    driver["socket"] = websocket
                    await websocket.send_str('SETTINGS,{"displayId":"primary","manual_width":1280,"manual_height":800,"is_manual_resolution_mode":true}')
                    async for message in websocket:
                        if message.type == WSMsgType.BINARY and len(message.data) >= 4:
                            driver["ready"].set()
                            await websocket.send_str(f"CLIENT_FRAME_ACK {int.from_bytes(message.data[2:4], 'big')}")
            except (OSError, ConnectionError):
                pass
            await asyncio.sleep(1)


async def ensure_driver(request, display, state):
    drivers = request.app["drivers"]
    current = drivers.get(display)
    # Control/view rotations leave this process and socket intact.
    if not current or current["pid"] != state["pid"] or current["task"].done():
        if current:
            current["task"].cancel()
            await asyncio.gather(current["task"], return_exceptions=True)
        current = {"pid": state["pid"], "ready": asyncio.Event()}
        current["task"] = asyncio.create_task(drive_stream(display, state, current))
        drivers[display] = current
    await asyncio.wait_for(current["ready"].wait(), timeout=15)
    return current


async def relay_websocket(request):
    token = request.query.get("token", "")
    target = resolve_token(token)
    if not target:
        raise web.HTTPForbidden()
    websocket = web.WebSocketResponse(protocols=("binary",), heartbeat=20, max_msg_size=16 * 1024 * 1024)
    await websocket.prepare(request)

    async def watch_permission():
        while not websocket.closed:
            await asyncio.sleep(0.5)
            if resolve_token(token) != target:
                await websocket.close(code=4002, message=b"Screen access ended")

    async def forward_socket(source, destination, public=False):
        async for message in source:
            if message.type == WSMsgType.TEXT:
                # The private primary owns the fixed video settings and lifetime.
                if not public and (message.data.startswith("SETTINGS,") or message.data in ("START_VIDEO", "STOP_VIDEO")):
                    if driver and (message.data.startswith("SETTINGS,") or message.data == "START_VIDEO"):
                        # A new viewer needs a fresh keyframe, including on a static desktop.
                        await driver["socket"].send_str("START_VIDEO")
                    continue
                await destination.send_str(public_message(message.data) if public else message.data)
            elif message.type == WSMsgType.BINARY:
                await destination.send_bytes(message.data)
            else:
                break

    tasks = [asyncio.create_task(watch_permission())]
    writer = None
    driver = None
    try:
        if target.startswith("screen:"):
            state = read_state(int(target.removeprefix("screen:")))
            if not state:
                return websocket
            if state.get("driver"):
                driver = await ensure_driver(request, int(target.removeprefix("screen:")), state)
            # Distinguish clients behind the gateway for Selkies's reconnect debounce.
            number = next(request.app.get("client_ids", itertools.count(65537))) % (1 << 24)
            address = f"127.{number >> 16}.{(number >> 8) & 255}.{number & 255}"
            async with ClientSession(connector=TCPConnector(local_addr=(address, 0))) as session:
                async with session.ws_connect(
                    f"http://127.0.0.1:{state['port']}/?token={token}", max_msg_size=16 * 1024 * 1024,
                ) as upstream:
                    tasks += [asyncio.create_task(forward_socket(websocket, upstream)), asyncio.create_task(forward_socket(upstream, websocket, public=True))]
                    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        elif target.startswith("unix_socket:"):
            # Preserve the existing terminal's raw UNIX stream over binary WebSockets.
            path = Path(target.removeprefix("unix_socket:"))
            if path.parent != ROOT / "sockets" or not path.name.startswith("terminal-"):
                return websocket
            reader, writer = await asyncio.open_unix_connection(str(path))

            async def to_terminal():
                async for message in websocket:
                    if message.type not in (WSMsgType.TEXT, WSMsgType.BINARY):
                        break
                    writer.write(message.data.encode() if message.type == WSMsgType.TEXT else message.data)
                    await writer.drain()

            async def from_terminal():
                while data := await reader.read(65536):
                    await websocket.send_bytes(data)

            tasks += [asyncio.create_task(to_terminal()), asyncio.create_task(from_terminal())]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except (OSError, ConnectionError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if writer:
            writer.close()
            await writer.wait_closed()
        await websocket.close()
    return websocket


async def static_file(request):
    name = request.match_info["path"]
    if name in ("", "embed.html", "index.html"):
        html = (WEB / "index.html").read_text()
        html = re.sub(r'<link rel="manifest"[^>]*>', "", html)
        # Keep the capability iframe opaque; storage and socket adaptation run before Selkies.
        html = html.replace("<head>", '<head><script src="./screen-bootstrap.js"></script>', 1)
        return web.Response(text=html, content_type="text/html", headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})
    if name == "screen-bootstrap.js":
        return web.FileResponse("/usr/local/share/rakazo/screen-bootstrap.js", headers={"Access-Control-Allow-Origin": "*"})
    if name == "manifest.json":
        return web.json_response({"name": "Rakazo computer", "display": "standalone"}, headers={"Access-Control-Allow-Origin": "*"})
    path = (WEB / name).resolve()
    if not path.is_relative_to(WEB.resolve()) or not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Access-Control-Allow-Origin": "*"})


def gateway(port):
    app = web.Application()
    app["drivers"] = {}
    app["client_ids"] = itertools.count(65537)
    async def cleanup(app):
        tasks = [entry["task"] for entry in app["drivers"].values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    app.on_cleanup.append(cleanup)
    app.router.add_get("/websockify", relay_websocket)
    app.router.add_get("/{path:.*}", static_file)
    web.run_app(app, host="0.0.0.0", port=port, access_log=None, print=None)


def gateway_start(port):
    with locked(f"gateway-{port}"):
        pid_file = ROOT / f"stream-gateway-{port}.pid"
        try:
            if running(int(pid_file.read_text()), HELPER):
                return
        except FileNotFoundError:
            pass
        with (ROOT / f"gateway-{port}.log").open("ab") as log:
            process = subprocess.Popen([sys.executable, HELPER, "gateway", str(port)], stdout=log, stderr=log, start_new_session=True)
        atomic_write(pid_file, str(process.pid))
        for _ in range(50):
            if process.poll() is not None:
                raise RuntimeError("screen gateway exited during startup")
            try:
                with LOCAL_HTTP.open(f"http://127.0.0.1:{port}/embed.html", timeout=1):
                    return
            except OSError:
                time.sleep(0.1)
        process.terminate()
        raise RuntimeError("screen gateway did not become ready")


def main():
    os.umask(0o077)
    if len(sys.argv) > 1 and sys.argv[1] == "worker":
        sys.argv = ["selkies", *sys.argv[2:]]
        from selkies.settings import settings_ws
        # The pinned server's list parser treats an empty list as its default.
        settings_ws.file_transfers = []
        from selkies.__main__ import main as run_streamer
        run_streamer()
        return
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("ensure", "control", "revoke", "stop", "reset", "gateway", "gateway-start"))
    parser.add_argument("number", type=int, nargs="?")
    parser.add_argument("token", nargs="?", default="")
    args = parser.parse_args()
    if args.action == "reset":
        for file in ROOT.glob("stream-*.json"):
            stop(int(file.stem.removeprefix("stream-")))
        return
    if args.number is None or not 1 <= args.number <= 65535:
        parser.error("invalid display or port")
    if args.action in ("ensure", "control") and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", args.token):
        parser.error("invalid screen token")
    if args.action == "ensure":
        ensure(args.number, args.token)
    elif args.action in ("control", "revoke"):
        control(args.number, args.token, revoke=args.action == "revoke")
    elif args.action == "stop":
        stop(args.number)
    elif args.action == "gateway":
        gateway(args.number)
    else:
        gateway_start(args.number)


if __name__ == "__main__":
    main()
