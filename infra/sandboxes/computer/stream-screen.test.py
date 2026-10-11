"""Offline tests: run with the computer image's /lsiopy/bin/python."""
import asyncio
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from aiohttp import ClientSession, WSMsgType, web
from aiohttp.test_utils import TestServer

spec = importlib.util.spec_from_file_location("screen", Path(__file__).with_name("stream-screen.py"))
screen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screen)


class PermissionsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.patches = [patch.object(screen, "ROOT", self.root), patch.object(screen, "TARGETS", self.root / "targets")]
        for item in self.patches:
            item.start()
        self.state = {"view": "viewer-token", "control": "controller-token", "pid": 123}
        screen.publish(1, self.state)

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.directory.cleanup()

    def test_roles_and_private_state(self):
        self.assertEqual(screen.token_permissions(self.state), {
            "viewer-token": {"role": "viewer"},
            "controller-token": {"role": "controller", "mk_control": True},
        })
        self.assertEqual(screen.state_path(1).stat().st_mode & 0o777, 0o600)

    def test_stale_release_preserves_new_controller(self):
        with patch.object(screen, "configure") as configure:
            screen.control(1, "old-controller", revoke=True)
            configure.assert_not_called()
        self.assertEqual(screen.read_state(1)["control"], "controller-token")

    def test_release_keeps_view_and_process(self):
        with patch.object(screen, "configure") as configure:
            screen.control(1, "controller-token", revoke=True)
            self.assertIsNone(configure.call_args.args[0]["control"])
        self.assertEqual(screen.resolve_token("viewer-token"), "screen:1")
        self.assertIsNone(screen.resolve_token("controller-token"))
        self.assertFalse((self.root / "control-token-1").exists())
        self.assertEqual(screen.read_state(1)["pid"], 123)

    def test_rotation_and_bot_separation(self):
        screen.publish(2, {"view": "second-view", "control": "second-control"})
        with patch.object(screen, "configure"):
            screen.control(1, "next-controller")
        self.assertIsNone(screen.resolve_token("controller-token"))
        self.assertEqual(screen.resolve_token("next-controller"), "screen:1")
        self.assertEqual(screen.resolve_token("second-control"), "screen:2")
        self.assertIsNone(screen.resolve_token("../viewer-token"))

    def test_unchanged_lease_keeps_stream(self):
        with patch.object(screen, "configure") as configure:
            screen.control(1, "controller-token")
            configure.assert_not_called()

    def test_browser_settings_never_expose_private_control_credentials(self):
        message = '{"type":"server_settings","settings":{"master_token":{"value":"private"},"control_port":{"value":8083},"encoder":{"value":"x264enc"}}}'
        public = screen.public_message(message)
        self.assertNotIn("private", public)
        self.assertNotIn("control_port", public)
        self.assertIn("x264enc", public)


class GatewayTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.patches = [patch.object(screen, "ROOT", self.root), patch.object(screen, "TARGETS", self.root / "targets")]
        for item in self.patches:
            item.start()
        app = web.Application()
        app.router.add_get("/websockify", screen.relay_websocket)
        self.gateway = TestServer(app)
        await self.gateway.start_server()
        self.session = ClientSession()

    async def asyncTearDown(self):
        await self.session.close()
        await self.gateway.close()
        for item in self.patches:
            item.stop()
        self.directory.cleanup()

    async def test_invalid_tokens_cannot_upgrade(self):
        for token in ("", "missing", "../token"):
            async with self.session.get(self.gateway.make_url(f"/websockify?token={token}")) as response:
                self.assertEqual(response.status, 403)

    async def test_stream_relay_and_revocation(self):
        seen = []
        async def upstream(request):
            seen.append(request.query["token"])
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            async for message in ws:
                if message.type == WSMsgType.TEXT:
                    await ws.send_str(message.data)
                elif message.type == WSMsgType.BINARY:
                    await ws.send_bytes(message.data)
            return ws
        app = web.Application()
        app.router.add_get("/", upstream)
        async with TestServer(app) as server:
            screen.publish(1, {"view": "viewer", "port": server.port})
            async with self.session.ws_connect(self.gateway.make_url("/websockify?token=viewer")) as ws:
                await ws.send_str("CLIENT_FRAME_ACK 1")
                self.assertEqual((await ws.receive(timeout=2)).data, "CLIENT_FRAME_ACK 1")
                await ws.send_bytes(b"video-frame")
                self.assertEqual((await ws.receive(timeout=2)).data, b"video-frame")
                self.assertEqual(seen, ["viewer"])
                screen.atomic_write(screen.TARGETS / "view-1", "")
                self.assertEqual((await ws.receive(timeout=2)).type, WSMsgType.CLOSE)
                self.assertEqual(ws.close_code, 4002)

    async def test_terminal_binary_subprotocol_and_revocation(self):
        socket = self.root / "sockets" / "terminal-1-test"
        socket.parent.mkdir()
        async def echo(reader, writer):
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()
            writer.close()
            await writer.wait_closed()
        server = await asyncio.start_unix_server(echo, str(socket))
        async with server:
            screen.atomic_write(screen.TARGETS / "terminal-1", f"terminal-token: unix_socket:{socket}\n")
            async with self.session.ws_connect(self.gateway.make_url("/websockify?token=terminal-token"), protocols=("binary",)) as ws:
                self.assertEqual(ws.protocol, "binary")
                await ws.send_bytes(b'{"type":"input","data":"pwd"}\n')
                self.assertEqual((await ws.receive(timeout=2)).data, b'{"type":"input","data":"pwd"}\n')
                screen.atomic_write(screen.TARGETS / "terminal-1", "")
                self.assertEqual((await ws.receive(timeout=2)).type, WSMsgType.CLOSE)


if __name__ == "__main__":
    unittest.main()
