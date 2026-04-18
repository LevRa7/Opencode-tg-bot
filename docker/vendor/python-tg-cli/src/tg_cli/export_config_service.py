"""Application/service layer for persistent export configuration."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .db import MessageDB


class ExportConfigService:
    def __init__(self, db: MessageDB):
        self.db = db

    def ensure_default_profile(self, user_id: str) -> dict[str, Any]:
        profile = self.db.get_export_config_profile(user_id)
        if profile is None:
            self.db.upsert_export_config_profile(
                user_id=user_id,
                default_scope="personal",
                include_media=False,
                media_kinds_json=[],
                max_file_size_bytes=20 * 1024 * 1024,
                since_ts=None,
                until_ts=None,
                updated_at=datetime.now(timezone.utc).isoformat(),
            )
            self.db.upsert_export_scope_default(user_id=user_id, scope_name="personal", enabled=True)
            profile = self.db.get_export_config_profile(user_id)
        profile["include_media"] = bool(profile["include_media"])
        return profile

    def set_scope_enabled(self, user_id: str, scope_name: str, enabled: bool) -> None:
        self.ensure_default_profile(user_id)
        self.db.upsert_export_scope_default(user_id=user_id, scope_name=scope_name, enabled=enabled)

    def set_chat_enabled(self, user_id: str, *, chat_id: int, scope_name: str | None, enabled: bool) -> None:
        self.ensure_default_profile(user_id)
        self.db.upsert_export_chat_override(
            user_id=user_id,
            chat_id=chat_id,
            scope_name=scope_name,
            enabled=enabled,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    def update_profile(
        self,
        user_id: str,
        *,
        include_media: bool,
        media_kinds: list[str],
        max_file_size_bytes: int,
        since_ts: str | None,
        until_ts: str | None,
    ) -> None:
        profile = self.ensure_default_profile(user_id)
        self.db.upsert_export_config_profile(
            user_id=user_id,
            default_scope=profile["default_scope"],
            include_media=include_media,
            media_kinds_json=media_kinds,
            max_file_size_bytes=max_file_size_bytes,
            since_ts=since_ts,
            until_ts=until_ts,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    def get_effective_config(self, user_id: str) -> dict[str, Any]:
        profile = self.ensure_default_profile(user_id)
        config = self.db.get_effective_export_config(user_id)
        if config["profile"] is None:
            config["profile"] = profile
        config["profile"]["include_media"] = bool(config["profile"]["include_media"])
        config["scopes"] = {key: bool(value) for key, value in config["scopes"].items()}
        for chat_id, row in config["chat_overrides"].items():
            row["enabled"] = bool(row["enabled"])
        return config
