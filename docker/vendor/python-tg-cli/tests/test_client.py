"""Tests for Telegram client helpers without hitting the network."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pytest

from tg_cli.client import (
    begin_phone_login,
    begin_qr_login,
    complete_password_login,
    complete_phone_login,
    complete_qr_login,
    connect,
    fetch_history,
    login_with_qr,
    sync_all,
)


@dataclass
class FakeEntity:
    id: int
    title: str


@dataclass
class FakeDialog:
    entity: FakeEntity
    name: str


@dataclass
class FakeSender:
    id: int
    first_name: str = "User"
    last_name: str = ""
    username: str | None = None


@dataclass
class FakeReplyTo:
    reply_to_msg_id: int


@dataclass
class FakeEntityItem:
    offset: int
    length: int
    url: str | None = None


@dataclass
class FakeMedia:
    kind: str = "media"


@dataclass
class FakeMessage:
    id: int
    sender_id: int
    text: str
    date: datetime
    message: str | None = None
    _sender: object = None
    reply_to: object | None = None
    edit_date: datetime | None = None
    grouped_id: int | None = None
    out: bool = False
    post: bool = False
    mentioned: bool = False
    pinned: bool = False
    via_bot_id: int | None = None
    views: int | None = None
    forwards: int | None = None
    replies: object | None = None
    entities: list[object] = field(default_factory=list)
    media: object | None = None
    action: object | None = None
    peer_id: object | None = None
    fwd_from: object | None = None

    def __post_init__(self):
        if self._sender is None:
            self._sender = FakeSender(id=self.sender_id)


class FakeClient:
    def __init__(self, dialogs: list[FakeDialog], messages_by_chat: dict[int, list[FakeMessage]]):
        self._dialogs = dialogs
        self._messages_by_chat = messages_by_chat

    async def get_entity(self, chat):
        if isinstance(chat, FakeEntity):
            return chat
        for dialog in self._dialogs:
            if chat == dialog.entity.id or chat == dialog.name:
                return dialog.entity
        raise ValueError(f"unknown chat: {chat}")

    async def iter_dialogs(self):
        for dialog in self._dialogs:
            yield dialog

    async def iter_messages(self, entity, limit: int, min_id: int = 0):
        messages = self._messages_by_chat.get(entity.id, [])
        for msg in messages[:limit]:
            if msg.id > min_id:
                yield msg


@pytest.mark.asyncio
async def test_fetch_history_returns_inserted_count(db):
    entity = FakeEntity(id=100, title="Test Group")
    client = FakeClient(
        dialogs=[FakeDialog(entity=entity, name="Test Group")],
        messages_by_chat={
            100: [
                FakeMessage(id=1, sender_id=1, text="old", date=datetime.now(timezone.utc)),
                FakeMessage(id=2, sender_id=1, text="new-1", date=datetime.now(timezone.utc)),
                FakeMessage(id=3, sender_id=1, text="new-2", date=datetime.now(timezone.utc)),
            ]
        },
    )

    db.insert_message(
        chat_id=100,
        chat_name="Test Group",
        msg_id=1,
        sender_id=1,
        sender_name="Alice",
        content="old",
        timestamp=datetime.now(timezone.utc),
    )

    inserted = await fetch_history(client, 100, db=db, limit=10, batch_delay=0)
    assert inserted == 2


@pytest.mark.asyncio
async def test_fetch_history_persists_raw_json_and_metadata(db):
    entity = FakeEntity(id=100, title="Test Group")
    client = FakeClient(
        dialogs=[FakeDialog(entity=entity, name="Test Group")],
        messages_by_chat={
            100: [
                FakeMessage(
                    id=10,
                    sender_id=7,
                    text="reply with metadata",
                    date=datetime.now(timezone.utc),
                    reply_to=FakeReplyTo(reply_to_msg_id=2),
                    grouped_id=99,
                    out=True,
                    entities=[FakeEntityItem(offset=0, length=5, url="https://example.com")],
                    media=FakeMedia(kind="document"),
                )
            ]
        },
    )

    inserted = await fetch_history(client, 100, db=db, limit=10, batch_delay=0)
    assert inserted == 1
    row = db.get_chat_messages(100)[0]
    assert row["reply_to_msg_id"] == 2
    assert row["message_kind"] != "message" or row["has_media"] == 1
    assert row["has_media"] == 1
    assert row["raw_json"] is not None


@pytest.mark.asyncio
async def test_sync_all_discovers_dialogs_from_client(db):
    dialogs = [
        FakeDialog(entity=FakeEntity(id=100, title="Group A"), name="Group A"),
        FakeDialog(entity=FakeEntity(id=200, title="Group B"), name="Group B"),
    ]
    client = FakeClient(
        dialogs=dialogs,
        messages_by_chat={
            100: [FakeMessage(id=1, sender_id=1, text="hello", date=datetime.now(timezone.utc))],
            200: [FakeMessage(id=1, sender_id=2, text="world", date=datetime.now(timezone.utc))],
        },
    )

    results = await sync_all(client, db, limit_per_chat=10, delay=0)
    assert results == {"Group A": 1, "Group B": 1}
    assert db.count() == 2


@pytest.mark.asyncio
async def test_sync_all_max_chats_limits_synced_dialogs(db):
    dialogs = [
        FakeDialog(entity=FakeEntity(id=100, title="Group A"), name="Group A"),
        FakeDialog(entity=FakeEntity(id=200, title="Group B"), name="Group B"),
        FakeDialog(entity=FakeEntity(id=300, title="Group C"), name="Group C"),
    ]
    client = FakeClient(
        dialogs=dialogs,
        messages_by_chat={
            100: [FakeMessage(id=1, sender_id=1, text="hello", date=datetime.now(timezone.utc))],
            200: [FakeMessage(id=1, sender_id=2, text="world", date=datetime.now(timezone.utc))],
            300: [FakeMessage(id=1, sender_id=3, text="bye", date=datetime.now(timezone.utc))],
        },
    )

    results = await sync_all(client, db, limit_per_chat=10, delay=0, max_chats=1)
    assert len(results) == 1
    assert db.count() == 1


@pytest.mark.asyncio
async def test_connect_uses_default_credentials_when_env_unset(monkeypatch):
    """When TG_API_ID/TG_API_HASH are not set, connect() should use Telegram Desktop defaults."""
    monkeypatch.delenv("TG_API_ID", raising=False)
    monkeypatch.delenv("TG_API_HASH", raising=False)

    from tg_cli.config import get_api_hash, get_api_id

    api_id = get_api_id()
    api_hash = get_api_hash()
    assert api_id is not None
    assert api_hash is not None
    assert isinstance(api_id, int)
    assert len(api_hash) > 0


@pytest.mark.asyncio
async def test_connect_uses_string_session_paths_for_tg_id(monkeypatch, tmp_path):
    monkeypatch.setenv("TG_ID", "6931112349")
    monkeypatch.setenv("TG_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    session_path = tmp_path / "6931112349" / ".tg-cli" / "6931112349.session.string"
    token_path = tmp_path / "6931112349" / ".tg-cli" / "6931112349.token"
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text("deadbeef", encoding="utf-8")
    session_path.parent.mkdir(parents=True, exist_ok=True)
    session_path.write_text("old", encoding="utf-8")

    captured = {}

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            return "deadbeef"

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            captured["session"] = session
            self.session = FakeStringSession()

        async def start(self):
            return self

        async def disconnect(self):
            return None

    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)
    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)

    async with client_mod.connect() as client:
        assert client is not None

    assert isinstance(captured["session"], FakeStringSession)
    assert session_path.exists()
    assert token_path.exists()
    assert session_path.read_text(encoding="utf-8") == "deadbeef"


@pytest.mark.asyncio
async def test_connect_persists_session_without_tg_id(monkeypatch, tmp_path):
    monkeypatch.delenv("TG_ID", raising=False)
    monkeypatch.delenv("TG_USER_ID", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    session_path = tmp_path / "data" / "tg_cli.session.string"
    token_path = tmp_path / "data" / "tg_cli.token"
    captured = {}

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            return "persisted-session"

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            captured["session"] = session
            self.session = FakeStringSession()

        async def start(self):
            return self

        async def disconnect(self):
            return None

    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)
    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)

    async with connect() as client:
        assert client is not None

    assert isinstance(captured["session"], FakeStringSession)
    assert session_path.read_text(encoding="utf-8") == "persisted-session"
    assert token_path.read_text(encoding="utf-8") == "persisted-session"


@pytest.mark.asyncio
async def test_begin_phone_login_requests_code_once_and_persists_pending_session(monkeypatch, tmp_path):
    monkeypatch.delenv("TG_ID", raising=False)
    monkeypatch.delenv("TG_USER_ID", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    calls = []
    session_path = tmp_path / "data" / "tg_cli.session.string"

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            return "pending-session"

    class FakeSentCode:
        phone_code_hash = "hash-123"
        timeout = 30

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            self.session = FakeStringSession()

        async def connect(self):
            calls.append("connect")

        async def is_user_authorized(self):
            return False

        async def send_code_request(self, phone):
            calls.append(("send_code_request", phone))
            return FakeSentCode()

        async def disconnect(self):
            calls.append("disconnect")
            return None

    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)
    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)

    payload = await begin_phone_login("+123456")

    assert payload["authenticated"] is False
    assert payload["phone_code_hash"] == "hash-123"
    assert payload["timeout"] == 30
    assert calls == ["connect", ("send_code_request", "+123456"), "disconnect"]
    assert session_path.read_text(encoding="utf-8") == "pending-session"


@pytest.mark.asyncio
async def test_complete_phone_login_uses_existing_hash_without_requesting_new_code(monkeypatch, tmp_path):
    monkeypatch.delenv("TG_ID", raising=False)
    monkeypatch.delenv("TG_USER_ID", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    session_path = tmp_path / "data" / "tg_cli.session.string"
    token_path = tmp_path / "data" / "tg_cli.token"
    session_path.parent.mkdir(parents=True, exist_ok=True)
    session_path.write_text("pending-auth", encoding="utf-8")
    token_path.write_text("pending-auth", encoding="utf-8")
    captured = {"sign_in": []}

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            return "authorized-session"

    class FakeMe:
        id = 123
        first_name = "Alice"
        last_name = "Smith"
        username = "alice"
        phone = "123456"

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            captured["loaded_session"] = session.string
            self.session = FakeStringSession()

        async def connect(self):
            return None

        async def is_user_authorized(self):
            return False

        async def send_code_request(self, phone):
            raise AssertionError("must not request a new code")

        async def sign_in(self, **kwargs):
            captured["sign_in"].append(kwargs)
            return None

        async def get_me(self):
            return FakeMe()

        async def disconnect(self):
            return None

    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)
    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)

    payload = await complete_phone_login("+123456", "11111", "hash-123")

    assert payload["authenticated"] is True
    assert payload["user"]["username"] == "alice"
    assert captured["loaded_session"] == "pending-auth"
    assert captured["sign_in"] == [
        {"phone": "+123456", "code": "11111", "phone_code_hash": "hash-123"}
    ]
    assert session_path.read_text(encoding="utf-8") == "authorized-session"
    assert token_path.read_text(encoding="utf-8") == "authorized-session"


@pytest.mark.asyncio
async def test_complete_phone_login_reports_password_required_and_password_step_finishes(monkeypatch, tmp_path):
    monkeypatch.delenv("TG_ID", raising=False)
    monkeypatch.delenv("TG_USER_ID", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    session_path = tmp_path / "data" / "tg_cli.session.string"
    token_path = tmp_path / "data" / "tg_cli.token"
    session_path.parent.mkdir(parents=True, exist_ok=True)
    session_path.write_text("pending-auth", encoding="utf-8")
    token_path.write_text("pending-auth", encoding="utf-8")
    captured = {"sign_in": []}

    class FakeMe:
        id = 123
        first_name = "Alice"
        last_name = "Smith"
        username = "alice"
        phone = "123456"

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            last_call = captured["sign_in"][-1]
            if "password" in last_call:
                return "authorized-session"
            return "pending-after-code"

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            self.session = FakeStringSession()

        async def connect(self):
            return None

        async def is_user_authorized(self):
            return False

        async def sign_in(self, **kwargs):
            captured["sign_in"].append(kwargs)
            if "password" not in kwargs:
                raise client_mod.SessionPasswordNeededError(None)
            return None

        async def get_me(self):
            return FakeMe()

        async def disconnect(self):
            return None

    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)
    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)

    first = await complete_phone_login("+123456", "11111", "hash-123")
    assert first == {"authenticated": False, "password_required": True, "next_step": "login-password"}
    assert session_path.read_text(encoding="utf-8") == "pending-after-code"
    assert token_path.read_text(encoding="utf-8") == "pending-after-code"

    second = await complete_password_login("secret")
    assert second["authenticated"] is True
    assert second["user"]["username"] == "alice"
    assert captured["sign_in"] == [
        {"phone": "+123456", "code": "11111", "phone_code_hash": "hash-123"},
        {"password": "secret"},
    ]
    assert session_path.read_text(encoding="utf-8") == "authorized-session"
    assert token_path.read_text(encoding="utf-8") == "authorized-session"


@pytest.mark.asyncio
async def test_begin_qr_login_returns_immediate_qr_payload(monkeypatch, tmp_path):
    monkeypatch.delenv("TG_ID", raising=False)
    monkeypatch.delenv("TG_USER_ID", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    calls = []
    session_path = tmp_path / "data" / "tg_cli.session.string"
    token_path = tmp_path / "data" / "tg_cli.token"

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            return "qr-pending-session"

    class FakeQRLogin:
        url = "tg://login?token=abc123"
        expires = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            self.session = FakeStringSession()

        async def connect(self):
            calls.append("connect")

        async def is_user_authorized(self):
            return False

        async def qr_login(self):
            calls.append("qr_login")
            return FakeQRLogin()

        async def disconnect(self):
            calls.append("disconnect")
            return None

    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)
    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)

    result = await begin_qr_login()

    assert result["event"] == "qr_ready"
    assert result["authenticated"] is False
    assert result["pending"] is True
    assert result["password_required"] is False
    assert result["next_step"] == "status"
    assert result["qr_url"] == "tg://login?token=abc123"
    assert result["png_path"].endswith(".login.qr.png")
    assert Path(result["png_path"]).exists()
    assert Path(result["png_path"]).read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    assert session_path.read_text(encoding="utf-8") == "qr-pending-session"
    assert token_path.read_text(encoding="utf-8") == "qr-pending-session"
    assert calls == ["connect", "qr_login", "disconnect"]


@pytest.mark.asyncio
async def test_login_with_qr_generates_png_and_returns_user_after_scan(monkeypatch, tmp_path):
    monkeypatch.delenv("TG_ID", raising=False)
    monkeypatch.delenv("TG_USER_ID", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    calls = []
    emitted = {}

    class FakeMe:
        id = 321
        first_name = "Bob"
        last_name = "Jones"
        username = "bobby"
        phone = "987654"

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            return "qr-authorized-session"

    class FakeQRLogin:
        url = "tg://login?token=abc123"
        expires = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)

        async def wait(self, timeout=None):
            calls.append(("wait", timeout))
            png_path = Path(emitted["png_path"])
            assert png_path.exists()
            assert png_path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
            return FakeMe()

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            self.session = FakeStringSession()

        async def connect(self):
            calls.append("connect")

        async def is_user_authorized(self):
            return False

        async def qr_login(self):
            calls.append("qr_login")
            return FakeQRLogin()

        async def disconnect(self):
            calls.append("disconnect")
            return None

    async def on_qr_ready(payload):
        emitted.update(payload)
        calls.append("on_qr_ready")

    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)
    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)

    result = await login_with_qr(on_qr_ready=on_qr_ready, wait_timeout=42)

    assert result["event"] == "authenticated"
    assert result["authenticated"] is True
    assert result["pending"] is False
    assert result["password_required"] is False
    assert result["qr_version"] == 1
    assert result["next_step"] == "login-qr-complete"
    assert result["user"]["username"] == "bobby"
    assert emitted["event"] == "qr_ready"
    assert emitted["qr_version"] == 1
    assert emitted["pending"] is True
    assert emitted["password_required"] is False
    assert emitted["qr_url"] == "tg://login?token=abc123"
    assert emitted["png_path"].endswith(".login.qr.png")
    assert calls == ["connect", "qr_login", "on_qr_ready", ("wait", 42), "disconnect"]


@pytest.mark.asyncio
async def test_login_with_qr_rotates_expired_code_and_emits_new_payload(monkeypatch, tmp_path):
    monkeypatch.delenv("TG_ID", raising=False)
    monkeypatch.delenv("TG_USER_ID", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    emitted = []
    calls = []

    class FakeMe:
        id = 321
        first_name = "Bob"
        last_name = "Jones"
        username = "bobby"
        phone = "987654"

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            return "qr-authorized-session"

    class FakeQRLogin:
        def __init__(self):
            self.url = "tg://login?token=first"
            self.expires = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
            self.wait_calls = 0

        async def recreate(self):
            calls.append("recreate")
            self.url = "tg://login?token=second"
            self.expires = datetime(2026, 4, 8, 12, 5, tzinfo=timezone.utc)

        async def wait(self, timeout=None):
            self.wait_calls += 1
            calls.append(("wait", self.wait_calls, timeout))
            if self.wait_calls == 1:
                raise TimeoutError()
            return FakeMe()

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            self.session = FakeStringSession()

        async def connect(self):
            calls.append("connect")

        async def is_user_authorized(self):
            return False

        async def qr_login(self):
            calls.append("qr_login")
            return FakeQRLogin()

        async def disconnect(self):
            calls.append("disconnect")
            return None

    async def on_qr_ready(payload):
        emitted.append(payload.copy())
        calls.append(("on_qr_ready", payload["qr_url"]))

    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)
    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)

    result = await login_with_qr(on_qr_ready=on_qr_ready, wait_timeout=15)

    assert result["event"] == "authenticated"
    assert result["authenticated"] is True
    assert result["qr_version"] == 2
    assert result["qr_url"] == "tg://login?token=second"
    assert result["user"]["username"] == "bobby"
    assert [item["event"] for item in emitted] == ["qr_ready", "qr_rotated"]
    assert [item["qr_version"] for item in emitted] == [1, 2]
    assert emitted[1]["replaces_qr_version"] == 1
    assert [item["qr_url"] for item in emitted] == [
        "tg://login?token=first",
        "tg://login?token=second",
    ]
    for item in emitted:
        assert Path(item["png_path"]).exists()
        assert Path(item["png_path"]).read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    assert calls == [
        "connect",
        "qr_login",
        ("on_qr_ready", "tg://login?token=first"),
        ("wait", 1, 15),
        "recreate",
        ("on_qr_ready", "tg://login?token=second"),
        ("wait", 2, 15),
        "disconnect",
    ]


@pytest.mark.asyncio
async def test_login_with_qr_reports_password_required(monkeypatch, tmp_path):
    monkeypatch.delenv("TG_ID", raising=False)
    monkeypatch.delenv("TG_USER_ID", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TG_API_ID", "12345")
    monkeypatch.setenv("TG_API_HASH", "abc123")

    import tg_cli.client as client_mod

    session_path = tmp_path / "data" / "tg_cli.session.string"
    token_path = tmp_path / "data" / "tg_cli.token"

    class FakeStringSession:
        def __init__(self, string=""):
            self.string = string

        def save(self):
            return "qr-pending-session"

    class FakeQRLogin:
        url = "tg://login?token=abc123"
        expires = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)

        async def wait(self, timeout=None):
            raise client_mod.SessionPasswordNeededError(None)

    class FakeClient:
        def __init__(self, session, *args, **kwargs):
            self.session = FakeStringSession()

        async def connect(self):
            return None

        async def is_user_authorized(self):
            return False

        async def qr_login(self):
            return FakeQRLogin()

        async def disconnect(self):
            return None

    monkeypatch.setattr(client_mod, "TelegramClient", FakeClient)
    monkeypatch.setattr(client_mod, "StringSession", FakeStringSession)

    result = await login_with_qr(wait_timeout=5)

    assert result["event"] == "password_required"
    assert result["authenticated"] is False
    assert result["qr_version"] == 1
    assert result["password_required"] is True
    assert result["next_step"] == "login-password"
    assert result["png_path"].endswith(".login.qr.png")
    assert session_path.read_text(encoding="utf-8") == "qr-pending-session"
    assert token_path.read_text(encoding="utf-8") == "qr-pending-session"
