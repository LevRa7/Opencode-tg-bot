"""TDD tests for export scope selection."""

from __future__ import annotations

from tg_cli.export_scopes import select_scope_chat_ids


class _FakeDB:
    def get_chats(self):
        return [
            {"chat_id": 1, "chat_name": "Alice", "chat_type": "user"},
            {"chat_id": 2, "chat_name": "GroupA", "chat_type": "group"},
            {"chat_id": 3, "chat_name": "ChannelA", "chat_type": "channel"},
            {"chat_id": 4, "chat_name": "ChannelB", "chat_type": "channel"},
        ]



def test_scope_personal_selects_only_users():
    ids = select_scope_chat_ids(_FakeDB(), scope="personal")
    assert ids == [1]


def test_scope_all_chats_selects_everything():
    ids = select_scope_chat_ids(_FakeDB(), scope="all_chats")
    assert ids == [1, 2, 3, 4]


def test_scope_all_channels_selects_only_channels():
    ids = select_scope_chat_ids(_FakeDB(), scope="all_channels")
    assert ids == [3, 4]


def test_scope_invalid_raises_value_error():
    import pytest

    with pytest.raises(ValueError):
        select_scope_chat_ids(_FakeDB(), scope="unknown")
