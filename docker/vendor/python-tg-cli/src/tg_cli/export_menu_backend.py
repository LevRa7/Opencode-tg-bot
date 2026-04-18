"""Bot-facing backend for /export_data settings menus."""

from __future__ import annotations

from typing import Any

from .export_config_service import ExportConfigService

_SCOPE_LABELS = {
    "personal": "Личные",
    "bots": "Боты",
    "group_chats": "Общие чаты",
    "public_channels": "Публичные каналы",
    "interlocutor_channels": "Каналы собеседников",
}


class ExportMenuBackend:
    def __init__(self, db: Any, service: ExportConfigService):
        self.db = db
        self.service = service

    def get_root_menu(self, user_id: str) -> dict[str, Any]:
        config = self.service.get_effective_config(user_id)
        groups = []
        for scope_name, label in _SCOPE_LABELS.items():
            groups.append(
                {
                    "scope_name": scope_name,
                    "label": label,
                    "enabled": bool(config["scopes"].get(scope_name, scope_name == "personal")),
                }
            )
        profile = config["profile"] or {}
        return {
            "groups": groups,
            "preferences": {
                "include_media": bool(profile.get("include_media", False)),
                "media_kinds": profile.get("media_kinds_json") or [],
                "max_file_size_bytes": profile.get("max_file_size_bytes", 20 * 1024 * 1024),
                "since_ts": profile.get("since_ts"),
                "until_ts": profile.get("until_ts"),
            },
        }

    def get_scope_menu(self, user_id: str, scope_name: str) -> dict[str, Any]:
        config = self.service.get_effective_config(user_id)
        chats = []
        for chat in self.db.get_chats():
            enabled = True
            override = config["chat_overrides"].get(chat["chat_id"])
            if override and (override.get("scope_name") == scope_name or override.get("scope_name") is None):
                enabled = bool(override["enabled"])
            chats.append(
                {
                    "chat_id": chat["chat_id"],
                    "chat_name": chat.get("chat_name") or str(chat["chat_id"]),
                    "enabled": enabled,
                }
            )
        return {
            "scope_name": scope_name,
            "label": _SCOPE_LABELS.get(scope_name, scope_name),
            "chats": chats,
        }
