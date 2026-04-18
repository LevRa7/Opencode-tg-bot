"""SQLite database for storing chat messages, event history, and derived dialog sessions."""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import get_db_path

log = logging.getLogger(__name__)

_SCHEMA_VERSION = 12

_CREATE_MESSAGES_TABLE = """
CREATE TABLE IF NOT EXISTS messages (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    platform                TEXT    NOT NULL DEFAULT 'telegram',
    chat_id                 INTEGER NOT NULL,
    chat_name               TEXT,
    msg_id                  INTEGER NOT NULL,
    sender_id               INTEGER,
    sender_name             TEXT,
    content                 TEXT,
    timestamp               TEXT    NOT NULL,
    reply_to_msg_id         INTEGER,
    message_kind            TEXT    NOT NULL DEFAULT 'message',
    has_media               INTEGER NOT NULL DEFAULT 0,
    is_forwarded            INTEGER NOT NULL DEFAULT 0,
    forwarded_from_id       TEXT,
    forwarded_from_name     TEXT,
    forwarded_date          TEXT,
    edit_date               TEXT,
    is_deleted              INTEGER NOT NULL DEFAULT 0,
    deleted_at              TEXT,
    first_observed_at       TEXT,
    last_observed_at        TEXT,
    read_state              TEXT,
    first_observed_read_at  TEXT,
    reaction_count          INTEGER NOT NULL DEFAULT 0,
    emoji_summary           TEXT,
    version_count           INTEGER NOT NULL DEFAULT 1,
    raw_json                TEXT,
    UNIQUE(platform, chat_id, msg_id)
);
"""

_CREATE_MESSAGE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_name);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(chat_id, reply_to_msg_id);
CREATE INDEX IF NOT EXISTS idx_messages_kind ON messages(chat_id, message_kind, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(chat_id, is_deleted, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_read_state ON messages(chat_id, read_state, first_observed_read_at);
CREATE INDEX IF NOT EXISTS idx_messages_forwarded ON messages(chat_id, is_forwarded, timestamp);
"""

_CREATE_EVENT_TABLES = """
CREATE TABLE IF NOT EXISTS message_versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id         INTEGER NOT NULL,
    msg_id          INTEGER NOT NULL,
    version_no      INTEGER NOT NULL,
    content         TEXT,
    observed_at     TEXT    NOT NULL,
    edit_date       TEXT,
    raw_json        TEXT,
    UNIQUE(chat_id, msg_id, version_no)
);

CREATE TABLE IF NOT EXISTS message_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id         INTEGER NOT NULL,
    msg_id          INTEGER NOT NULL,
    actor_id        TEXT,
    event_type      TEXT    NOT NULL,
    event_ts        TEXT    NOT NULL,
    payload_json    TEXT
);

CREATE TABLE IF NOT EXISTS message_reads (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id                  INTEGER NOT NULL,
    msg_id                   INTEGER NOT NULL,
    direction                TEXT    NOT NULL,
    first_observed_read_at   TEXT    NOT NULL,
    source                   TEXT    NOT NULL,
    confidence               REAL    NOT NULL DEFAULT 0.5
);

CREATE TABLE IF NOT EXISTS message_reactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id         INTEGER NOT NULL,
    msg_id          INTEGER NOT NULL,
    reaction        TEXT    NOT NULL,
    actor_id        TEXT,
    observed_at     TEXT    NOT NULL,
    removed_at      TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
    chat_id                     INTEGER PRIMARY KEY,
    last_msg_id                 INTEGER,
    last_pts                    INTEGER,
    last_qts                    INTEGER,
    last_date                   TEXT,
    last_full_scan_at           TEXT,
    last_listener_heartbeat_at  TEXT
);
"""

_CREATE_EVENT_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_message_versions_msg ON message_versions(chat_id, msg_id, version_no);
CREATE INDEX IF NOT EXISTS idx_message_events_msg ON message_events(chat_id, msg_id, event_ts);
CREATE INDEX IF NOT EXISTS idx_message_events_type ON message_events(chat_id, event_type, event_ts);
CREATE INDEX IF NOT EXISTS idx_message_reads_msg ON message_reads(chat_id, msg_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_msg ON message_reactions(chat_id, msg_id, observed_at);
"""

_CREATE_DIALOG_SESSION_TABLES = """
CREATE TABLE IF NOT EXISTS dialog_sessions (
    session_id          TEXT PRIMARY KEY,
    platform            TEXT    NOT NULL DEFAULT 'telegram',
    chat_id             INTEGER NOT NULL UNIQUE,
    chat_name           TEXT,
    dialog_type         TEXT,
    first_msg_ts        TEXT,
    last_msg_ts         TEXT,
    message_count       INTEGER NOT NULL DEFAULT 0,
    segment_count       INTEGER NOT NULL DEFAULT 0,
    last_raw_msg_id     INTEGER,
    last_built_at       TEXT    NOT NULL,
    compacted_msg_id    INTEGER,
    last_compaction_at  TEXT
);

CREATE TABLE IF NOT EXISTS dialog_segments (
    segment_id       TEXT PRIMARY KEY,
    session_id       TEXT    NOT NULL,
    chat_id          INTEGER NOT NULL,
    seq              INTEGER NOT NULL,
    start_msg_id     INTEGER NOT NULL,
    end_msg_id       INTEGER NOT NULL,
    start_ts         TEXT    NOT NULL,
    end_ts           TEXT    NOT NULL,
    message_count    INTEGER NOT NULL,
    dominant_sender  TEXT,
    topic_hint       TEXT,
    summary          TEXT,
    status           TEXT    NOT NULL DEFAULT 'active',
    UNIQUE(session_id, seq)
);

CREATE TABLE IF NOT EXISTS dialog_summaries (
    summary_id     TEXT PRIMARY KEY,
    session_id     TEXT    NOT NULL,
    chat_id        INTEGER NOT NULL,
    segment_id     TEXT,
    kind           TEXT    NOT NULL,
    summary        TEXT    NOT NULL,
    payload_json   TEXT,
    created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS dialog_facts (
    fact_id        TEXT PRIMARY KEY,
    session_id     TEXT    NOT NULL,
    chat_id        INTEGER NOT NULL,
    fact_type      TEXT    NOT NULL,
    subject        TEXT,
    predicate      TEXT    NOT NULL,
    object         TEXT,
    value_json     TEXT,
    confidence     REAL    NOT NULL DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'active',
    created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS dialog_evidence (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT    NOT NULL,
    chat_id      INTEGER NOT NULL,
    owner_type   TEXT    NOT NULL,
    owner_id     TEXT    NOT NULL,
    msg_id       INTEGER NOT NULL,
    note         TEXT
);

CREATE TABLE IF NOT EXISTS dialog_compactions (
    compaction_id        TEXT PRIMARY KEY,
    session_id           TEXT    NOT NULL,
    chat_id              INTEGER NOT NULL,
    summary_id           TEXT,
    covered_until_msg_id INTEGER,
    preserved_tail_count INTEGER NOT NULL DEFAULT 0,
    policy_json          TEXT,
    created_at           TEXT    NOT NULL
);
"""

_CREATE_DIALOG_SESSION_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_last_msg ON dialog_sessions(last_msg_ts);
CREATE INDEX IF NOT EXISTS idx_dialog_segments_chat_seq ON dialog_segments(chat_id, seq);
CREATE INDEX IF NOT EXISTS idx_dialog_summaries_chat_kind ON dialog_summaries(chat_id, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_dialog_facts_chat_type ON dialog_facts(chat_id, fact_type, created_at);
CREATE INDEX IF NOT EXISTS idx_dialog_evidence_owner ON dialog_evidence(chat_id, owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_dialog_compactions_chat ON dialog_compactions(chat_id, created_at);
"""

_CREATE_SUBJECT_TABLES = """
CREATE TABLE IF NOT EXISTS subjects (
    subject_id        TEXT PRIMARY KEY,
    platform          TEXT NOT NULL DEFAULT 'telegram',
    external_id       TEXT,
    display_name      TEXT,
    first_seen_at     TEXT,
    last_seen_at      TEXT
);

CREATE TABLE IF NOT EXISTS subject_aliases (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id        TEXT NOT NULL,
    alias_type        TEXT NOT NULL,
    alias_value       TEXT NOT NULL,
    first_seen_at     TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL,
    source_msg_id     INTEGER
);

CREATE TABLE IF NOT EXISTS subject_observations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id         TEXT NOT NULL,
    chat_id            INTEGER NOT NULL,
    field              TEXT NOT NULL,
    value              TEXT NOT NULL,
    explicitly_stated  INTEGER NOT NULL DEFAULT 1,
    confidence         REAL NOT NULL DEFAULT 1.0,
    observed_at        TEXT NOT NULL,
    source_msg_id      INTEGER NOT NULL,
    notes              TEXT
);
"""

_CREATE_SUBJECT_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_subject_aliases_subject ON subject_aliases(subject_id, alias_type, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_subject_observations_subject ON subject_observations(subject_id, field, observed_at);
CREATE INDEX IF NOT EXISTS idx_subject_observations_chat ON subject_observations(chat_id, subject_id, observed_at);
"""

_CREATE_ASSERTION_TABLES = """
CREATE TABLE IF NOT EXISTS subject_assertions (
    assertion_id             TEXT PRIMARY KEY,
    subject_id               TEXT NOT NULL,
    chat_id                  INTEGER NOT NULL,
    field                    TEXT NOT NULL,
    value                    TEXT NOT NULL,
    status                   TEXT NOT NULL,
    confidence               REAL NOT NULL,
    valid_from_ts            TEXT,
    valid_to_ts              TEXT,
    first_seen_at            TEXT NOT NULL,
    last_seen_at             TEXT NOT NULL,
    supersedes_assertion_id  TEXT,
    source_type              TEXT NOT NULL,
    notes                    TEXT
);

CREATE TABLE IF NOT EXISTS assertion_evidence (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    assertion_id      TEXT NOT NULL,
    source_msg_id     INTEGER NOT NULL,
    evidence_type     TEXT NOT NULL,
    observed_at       TEXT NOT NULL
);
"""

_CREATE_ASSERTION_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_subject_assertions_active ON subject_assertions(subject_id, field, status, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_subject_assertions_chat ON subject_assertions(chat_id, subject_id, field, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_assertion_evidence_assertion ON assertion_evidence(assertion_id, observed_at);
"""

_CREATE_INTERACTION_TABLES = """
CREATE TABLE IF NOT EXISTS interaction_patterns (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id            INTEGER NOT NULL,
    subject_id         TEXT NOT NULL,
    pattern_type       TEXT NOT NULL,
    summary            TEXT NOT NULL,
    confidence         REAL NOT NULL,
    first_seen_at      TEXT NOT NULL,
    last_seen_at       TEXT NOT NULL,
    evidence_json      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interaction_metrics_daily (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id                   INTEGER NOT NULL,
    subject_id                TEXT NOT NULL,
    day                       TEXT NOT NULL,
    sent_count                INTEGER NOT NULL DEFAULT 0,
    reply_count               INTEGER NOT NULL DEFAULT 0,
    reaction_count            INTEGER NOT NULL DEFAULT 0,
    edit_count                INTEGER NOT NULL DEFAULT 0,
    delete_count              INTEGER NOT NULL DEFAULT 0,
    avg_response_latency_sec  REAL,
    avg_read_latency_sec      REAL,
    emoji_count               INTEGER NOT NULL DEFAULT 0,
    top_emojis_json           TEXT,
    UNIQUE(chat_id, subject_id, day)
);
"""

_CREATE_INTERACTION_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_interaction_patterns_subject ON interaction_patterns(chat_id, subject_id, pattern_type, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_interaction_metrics_day ON interaction_metrics_daily(chat_id, subject_id, day);
"""

_CREATE_EMBEDDING_TABLES = """
CREATE TABLE IF NOT EXISTS embedding_models (
    model_id           TEXT PRIMARY KEY,
    provider           TEXT NOT NULL,
    dimension          INTEGER NOT NULL,
    created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_documents (
    doc_id             TEXT PRIMARY KEY,
    chat_id            INTEGER NOT NULL,
    subject_id         TEXT,
    source_type        TEXT NOT NULL,
    source_id          TEXT NOT NULL,
    content            TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    is_active          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS embedding_vectors (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id             TEXT NOT NULL,
    model_id           TEXT NOT NULL,
    vector_blob        BLOB,
    created_at         TEXT NOT NULL
);
"""

_CREATE_EMBEDDING_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_embedding_documents_chat ON embedding_documents(chat_id, source_type, is_active);
CREATE INDEX IF NOT EXISTS idx_embedding_documents_subject ON embedding_documents(subject_id, source_type, is_active);
CREATE INDEX IF NOT EXISTS idx_embedding_vectors_doc ON embedding_vectors(doc_id, model_id);
"""

_CREATE_ONTOLOGY_TABLES = """
CREATE TABLE IF NOT EXISTS ontology_entities (
    entity_id     TEXT PRIMARY KEY,
    entity_type   TEXT NOT NULL,
    label         TEXT NOT NULL,
    status        TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology_relations (
    relation_id        TEXT PRIMARY KEY,
    subject_entity_id  TEXT NOT NULL,
    predicate          TEXT NOT NULL,
    object_entity_id   TEXT,
    object_value       TEXT,
    confidence         REAL NOT NULL,
    status             TEXT NOT NULL,
    valid_from_ts      TEXT,
    valid_to_ts        TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology_evidence (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    relation_id       TEXT NOT NULL,
    source_msg_id     INTEGER NOT NULL,
    evidence_type     TEXT NOT NULL,
    observed_at       TEXT NOT NULL
);
"""

_CREATE_ONTOLOGY_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_ontology_entities_type ON ontology_entities(entity_type, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ontology_relations_subject ON ontology_relations(subject_entity_id, predicate, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ontology_evidence_relation ON ontology_evidence(relation_id, observed_at);
"""

_CREATE_MEDIA_TABLES = """
CREATE TABLE IF NOT EXISTS media_assets (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id            INTEGER NOT NULL,
    msg_id             INTEGER NOT NULL,
    media_kind         TEXT NOT NULL,
    mime_type          TEXT,
    size_bytes         INTEGER,
    file_path          TEXT,
    downloaded_at      TEXT,
    sha256             TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    error              TEXT
);

CREATE TABLE IF NOT EXISTS media_transcripts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id            INTEGER NOT NULL,
    msg_id             INTEGER NOT NULL,
    asset_id           INTEGER,
    engine             TEXT,
    language           TEXT,
    transcript_text    TEXT,
    segments_json      TEXT,
    confidence         REAL,
    created_at         TEXT,
    sent_to_owner_at   TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    error              TEXT
);
"""

_CREATE_MEDIA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_media_assets_msg ON media_assets(chat_id, msg_id, status);
CREATE INDEX IF NOT EXISTS idx_media_transcripts_msg ON media_transcripts(chat_id, msg_id, status);
"""

_CREATE_EXPORT_CONFIG_TABLES = """
CREATE TABLE IF NOT EXISTS export_config_profiles (
    user_id               TEXT PRIMARY KEY,
    default_scope         TEXT NOT NULL DEFAULT 'personal',
    include_media         INTEGER NOT NULL DEFAULT 0,
    media_kinds_json      TEXT,
    max_file_size_bytes   INTEGER NOT NULL DEFAULT 20971520,
    since_ts              TEXT,
    until_ts              TEXT,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_scope_defaults (
    user_id               TEXT NOT NULL,
    scope_name            TEXT NOT NULL,
    enabled               INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, scope_name)
);

CREATE TABLE IF NOT EXISTS export_chat_overrides (
    user_id               TEXT NOT NULL,
    chat_id               INTEGER NOT NULL,
    scope_name            TEXT,
    enabled               INTEGER NOT NULL,
    updated_at            TEXT NOT NULL,
    PRIMARY KEY(user_id, chat_id)
);
"""

_CREATE_EXPORT_CONFIG_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_export_scope_defaults_user ON export_scope_defaults(user_id, scope_name);
CREATE INDEX IF NOT EXISTS idx_export_chat_overrides_user ON export_chat_overrides(user_id, scope_name, updated_at);
"""

_CREATE_PROFILE_MEDIA_TABLES = """
CREATE TABLE IF NOT EXISTS subject_profiles (
    subject_id        TEXT PRIMARY KEY,
    display_name      TEXT,
    username          TEXT,
    bio               TEXT,
    avatar_ref        TEXT,
    tg_external_id    TEXT,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subject_profile_photos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id        TEXT NOT NULL,
    photo_ref         TEXT NOT NULL,
    observed_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subject_profile_music (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id        TEXT NOT NULL,
    title             TEXT,
    performer         TEXT,
    file_name         TEXT,
    observed_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subject_profile_links (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id        TEXT NOT NULL,
    link_type         TEXT NOT NULL,
    label             TEXT,
    url               TEXT,
    observed_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_media (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id           INTEGER NOT NULL,
    msg_id            INTEGER NOT NULL,
    media_type        TEXT NOT NULL,
    title             TEXT,
    performer         TEXT,
    duration_sec      REAL,
    file_name         TEXT,
    mime_type         TEXT,
    caption           TEXT,
    observed_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_reposts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id           INTEGER NOT NULL,
    msg_id            INTEGER NOT NULL,
    source_type       TEXT NOT NULL,
    source_id         TEXT,
    source_name       TEXT,
    forwarded_date    TEXT,
    observed_at       TEXT NOT NULL
);
"""

_CREATE_PROFILE_MEDIA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_subject_profile_music_subject ON subject_profile_music(subject_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_subject_profile_links_subject ON subject_profile_links(subject_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_message_media_msg ON message_media(chat_id, msg_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_message_reposts_msg ON message_reposts(chat_id, msg_id, observed_at);
"""


_MESSAGE_EXTRA_COLUMNS: dict[str, tuple[str, str]] = {
    "reply_to_msg_id": ("INTEGER", "reply_to_msg_id INTEGER"),
    "message_kind": ("TEXT", "message_kind TEXT NOT NULL DEFAULT 'message'"),
    "has_media": ("INTEGER", "has_media INTEGER NOT NULL DEFAULT 0"),
    "is_forwarded": ("INTEGER", "is_forwarded INTEGER NOT NULL DEFAULT 0"),
    "forwarded_from_id": ("TEXT", "forwarded_from_id TEXT"),
    "forwarded_from_name": ("TEXT", "forwarded_from_name TEXT"),
    "forwarded_date": ("TEXT", "forwarded_date TEXT"),
    "edit_date": ("TEXT", "edit_date TEXT"),
    "is_deleted": ("INTEGER", "is_deleted INTEGER NOT NULL DEFAULT 0"),
    "deleted_at": ("TEXT", "deleted_at TEXT"),
    "first_observed_at": ("TEXT", "first_observed_at TEXT"),
    "last_observed_at": ("TEXT", "last_observed_at TEXT"),
    "read_state": ("TEXT", "read_state TEXT"),
    "first_observed_read_at": ("TEXT", "first_observed_read_at TEXT"),
    "reaction_count": ("INTEGER", "reaction_count INTEGER NOT NULL DEFAULT 0"),
    "emoji_summary": ("TEXT", "emoji_summary TEXT"),
    "version_count": ("INTEGER", "version_count INTEGER NOT NULL DEFAULT 1"),
}


def _canonical_chat_id(chat_id: int) -> int:
    if chat_id < 0:
        digits = str(abs(chat_id))
        if digits.startswith("100") and len(digits) > 3:
            return int(digits[3:])
        return abs(chat_id)
    return chat_id


def _table_has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row[1] == column for row in rows)


def _set_user_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(f"PRAGMA user_version = {version}")


def _json_dumps(data: Any | None) -> str | None:
    if data is None:
        return None
    return json.dumps(data, ensure_ascii=False)


class MessageDB:
    """SQLite message store with context manager support."""

    def __init__(self, db_path: Path | str | None = None):
        if db_path is None:
            self.db_path = get_db_path()
        else:
            self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    def _migrate(self) -> None:
        self.conn.execute(_CREATE_MESSAGES_TABLE)
        version_row = self.conn.execute("PRAGMA user_version").fetchone()
        version = int(version_row[0]) if version_row is not None else 0

        if version < 1:
            _set_user_version(self.conn, 1)
            version = 1

        if version < 2:
            for column, (_, ddl) in _MESSAGE_EXTRA_COLUMNS.items():
                if not _table_has_column(self.conn, "messages", column):
                    self.conn.execute(f"ALTER TABLE messages ADD COLUMN {ddl}")
            _set_user_version(self.conn, 2)
            version = 2

        self.conn.executescript(_CREATE_MESSAGE_INDEXES)

        if version < 3:
            self.conn.executescript(_CREATE_DIALOG_SESSION_TABLES + _CREATE_DIALOG_SESSION_INDEXES)
            _set_user_version(self.conn, 3)
            version = 3

        if version < 4:
            self.conn.executescript(_CREATE_EVENT_TABLES + _CREATE_EVENT_INDEXES)
            _set_user_version(self.conn, 4)
            version = 4

        if version < 5:
            self.conn.executescript(_CREATE_SUBJECT_TABLES + _CREATE_SUBJECT_INDEXES)
            _set_user_version(self.conn, 5)
            version = 5

        if version < 6:
            self.conn.executescript(_CREATE_ASSERTION_TABLES + _CREATE_ASSERTION_INDEXES)
            _set_user_version(self.conn, 6)
            version = 6

        if version < 7:
            self.conn.executescript(_CREATE_INTERACTION_TABLES + _CREATE_INTERACTION_INDEXES)
            _set_user_version(self.conn, 7)
            version = 7

        if version < 8:
            self.conn.executescript(_CREATE_EMBEDDING_TABLES + _CREATE_EMBEDDING_INDEXES)
            _set_user_version(self.conn, 8)
            version = 8

        if version < 9:
            self.conn.executescript(_CREATE_ONTOLOGY_TABLES + _CREATE_ONTOLOGY_INDEXES)
            _set_user_version(self.conn, 9)
            version = 9

        if version < 10:
            self.conn.executescript(_CREATE_MEDIA_TABLES + _CREATE_MEDIA_INDEXES)
            _set_user_version(self.conn, 10)
            version = 10

        if version < 11:
            self.conn.executescript(_CREATE_EXPORT_CONFIG_TABLES + _CREATE_EXPORT_CONFIG_INDEXES)
            _set_user_version(self.conn, 11)
            version = 11

        if version < 12:
            self.conn.executescript(_CREATE_PROFILE_MEDIA_TABLES + _CREATE_PROFILE_MEDIA_INDEXES)
            _set_user_version(self.conn, 12)

        self.conn.commit()

    def find_chats(self, chat_str: str) -> list[dict]:
        chats = self.get_chats()
        try:
            numeric_id = _canonical_chat_id(int(chat_str))
            exact_id_matches = [c for c in chats if c["chat_id"] == numeric_id]
            if exact_id_matches:
                return exact_id_matches
        except ValueError:
            pass

        exact_name_matches = [
            c for c in chats if c["chat_name"] and c["chat_name"].casefold() == chat_str.casefold()
        ]
        if exact_name_matches:
            return exact_name_matches

        return [
            c for c in chats if c["chat_name"] and chat_str.casefold() in c["chat_name"].casefold()
        ]

    def resolve_chat_id(self, chat_str: str) -> int | None:
        matches = self.find_chats(chat_str)
        if len(matches) == 1:
            return matches[0]["chat_id"]
        return None

    def get_message(self, chat_id: int, msg_id: int) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM messages WHERE chat_id = ? AND msg_id = ?",
            (chat_id, msg_id),
        ).fetchone()
        return dict(row) if row else None

    def insert_message(
        self,
        *,
        platform: str = "telegram",
        chat_id: int,
        chat_name: str | None,
        msg_id: int,
        sender_id: int | None,
        sender_name: str | None,
        content: str | None,
        timestamp: datetime,
        reply_to_msg_id: int | None = None,
        message_kind: str = "message",
        has_media: bool = False,
        is_forwarded: bool = False,
        forwarded_from_id: str | None = None,
        forwarded_from_name: str | None = None,
        forwarded_date: str | None = None,
        edit_date: str | None = None,
        is_deleted: bool = False,
        deleted_at: str | None = None,
        first_observed_at: str | None = None,
        last_observed_at: str | None = None,
        read_state: str | None = None,
        first_observed_read_at: str | None = None,
        reaction_count: int = 0,
        emoji_summary: str | None = None,
        version_count: int = 1,
        raw_json: dict[str, Any] | None = None,
    ) -> bool:
        try:
            cursor = self.conn.execute(
                """INSERT OR IGNORE INTO messages (
                       platform, chat_id, chat_name, msg_id, sender_id, sender_name,
                       content, timestamp, reply_to_msg_id, message_kind, has_media,
                       is_forwarded, forwarded_from_id, forwarded_from_name, forwarded_date,
                       edit_date, is_deleted, deleted_at, first_observed_at, last_observed_at,
                       read_state, first_observed_read_at, reaction_count, emoji_summary,
                       version_count, raw_json
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    platform,
                    chat_id,
                    chat_name,
                    msg_id,
                    sender_id,
                    sender_name,
                    content,
                    timestamp.isoformat() if isinstance(timestamp, datetime) else timestamp,
                    reply_to_msg_id,
                    message_kind,
                    int(bool(has_media)),
                    int(bool(is_forwarded)),
                    forwarded_from_id,
                    forwarded_from_name,
                    forwarded_date,
                    edit_date,
                    int(bool(is_deleted)),
                    deleted_at,
                    first_observed_at,
                    last_observed_at,
                    read_state,
                    first_observed_read_at,
                    reaction_count,
                    emoji_summary,
                    version_count,
                    _json_dumps(raw_json),
                ),
            )
            self.conn.commit()
            return cursor.rowcount > 0
        except sqlite3.Error as e:
            log.debug("insert_message failed: %s", e)
            return False

    def upsert_message_state(self, message: dict[str, Any], *, platform: str = "telegram") -> None:
        existing = self.get_message(message["chat_id"], message["msg_id"])
        if existing is None:
            self.insert_message(platform=platform, **message)
            return
        self.conn.execute(
            """UPDATE messages SET
                   platform = ?,
                   chat_name = ?,
                   sender_id = ?,
                   sender_name = ?,
                   content = ?,
                   timestamp = ?,
                   reply_to_msg_id = ?,
                   message_kind = ?,
                   has_media = ?,
                   is_forwarded = ?,
                   forwarded_from_id = ?,
                   forwarded_from_name = ?,
                   forwarded_date = ?,
                   edit_date = ?,
                   is_deleted = ?,
                   deleted_at = ?,
                   first_observed_at = COALESCE(first_observed_at, ?),
                   last_observed_at = ?,
                   read_state = ?,
                   first_observed_read_at = COALESCE(first_observed_read_at, ?),
                   reaction_count = ?,
                   emoji_summary = ?,
                   version_count = ?,
                   raw_json = ?
               WHERE chat_id = ? AND msg_id = ?""",
            (
                platform,
                message.get("chat_name"),
                message.get("sender_id"),
                message.get("sender_name"),
                message.get("content"),
                message["timestamp"]
                if isinstance(message["timestamp"], str)
                else message["timestamp"].isoformat(),
                message.get("reply_to_msg_id"),
                message.get("message_kind", "message"),
                int(bool(message.get("has_media", False))),
                int(bool(message.get("is_forwarded", False))),
                message.get("forwarded_from_id"),
                message.get("forwarded_from_name"),
                message.get("forwarded_date"),
                message.get("edit_date"),
                int(bool(message.get("is_deleted", False))),
                message.get("deleted_at"),
                message.get("first_observed_at"),
                message.get("last_observed_at"),
                message.get("read_state"),
                message.get("first_observed_read_at"),
                int(message.get("reaction_count", 0) or 0),
                message.get("emoji_summary"),
                int(message.get("version_count", 1) or 1),
                _json_dumps(message.get("raw_json")),
                message["chat_id"],
                message["msg_id"],
            ),
        )
        self.conn.commit()

    def insert_batch(self, messages: list[dict], platform: str = "telegram") -> int:
        if not messages:
            return 0
        rows = [
            (
                platform,
                m["chat_id"],
                m.get("chat_name"),
                m["msg_id"],
                m.get("sender_id"),
                m.get("sender_name"),
                m.get("content"),
                m["timestamp"].isoformat() if isinstance(m["timestamp"], datetime) else m["timestamp"],
                m.get("reply_to_msg_id"),
                m.get("message_kind", "message"),
                int(bool(m.get("has_media", False))),
                int(bool(m.get("is_forwarded", False))),
                m.get("forwarded_from_id"),
                m.get("forwarded_from_name"),
                m.get("forwarded_date"),
                m.get("edit_date"),
                int(bool(m.get("is_deleted", False))),
                m.get("deleted_at"),
                m.get("first_observed_at"),
                m.get("last_observed_at"),
                m.get("read_state"),
                m.get("first_observed_read_at"),
                int(m.get("reaction_count", 0) or 0),
                m.get("emoji_summary"),
                int(m.get("version_count", 1) or 1),
                _json_dumps(m.get("raw_json")),
            )
            for m in messages
        ]
        try:
            before = self.conn.total_changes
            self.conn.executemany(
                """INSERT OR IGNORE INTO messages (
                       platform, chat_id, chat_name, msg_id, sender_id, sender_name,
                       content, timestamp, reply_to_msg_id, message_kind, has_media,
                       is_forwarded, forwarded_from_id, forwarded_from_name, forwarded_date,
                       edit_date, is_deleted, deleted_at, first_observed_at, last_observed_at,
                       read_state, first_observed_read_at, reaction_count, emoji_summary,
                       version_count, raw_json
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
            self.conn.commit()
            return self.conn.total_changes - before
        except sqlite3.Error as e:
            log.warning("insert_batch failed: %s", e)
            return 0

    def insert_message_version(
        self,
        *,
        chat_id: int,
        msg_id: int,
        version_no: int,
        content: str | None,
        observed_at: str,
        edit_date: str | None,
        raw_json: dict[str, Any] | None,
    ) -> None:
        self.conn.execute(
            """INSERT OR IGNORE INTO message_versions (
                   chat_id, msg_id, version_no, content, observed_at, edit_date, raw_json
               ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (chat_id, msg_id, version_no, content, observed_at, edit_date, _json_dumps(raw_json)),
        )
        self.conn.commit()

    def list_message_versions(self, chat_id: int, msg_id: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM message_versions WHERE chat_id = ? AND msg_id = ? ORDER BY version_no ASC",
            (chat_id, msg_id),
        ).fetchall()
        return [dict(row) for row in rows]

    def insert_message_event(
        self,
        *,
        chat_id: int,
        msg_id: int,
        event_type: str,
        event_ts: str,
        actor_id: str | None = None,
        payload_json: dict[str, Any] | None = None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO message_events (chat_id, msg_id, actor_id, event_type, event_ts, payload_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (chat_id, msg_id, actor_id, event_type, event_ts, _json_dumps(payload_json)),
        )
        self.conn.commit()

    def list_message_events(self, chat_id: int, msg_id: int | None = None) -> list[dict[str, Any]]:
        if msg_id is None:
            rows = self.conn.execute(
                "SELECT * FROM message_events WHERE chat_id = ? ORDER BY id ASC",
                (chat_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM message_events WHERE chat_id = ? AND msg_id = ? ORDER BY id ASC",
                (chat_id, msg_id),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            if item.get("payload_json"):
                item["payload_json"] = json.loads(item["payload_json"])
            result.append(item)
        return result

    def mark_message_deleted(self, chat_id: int, msg_id: int, *, deleted_at: str) -> None:
        self.conn.execute(
            "UPDATE messages SET is_deleted = 1, deleted_at = ?, last_observed_at = ? WHERE chat_id = ? AND msg_id = ?",
            (deleted_at, deleted_at, chat_id, msg_id),
        )
        self.conn.commit()

    def record_message_read(
        self,
        *,
        chat_id: int,
        msg_id: int,
        direction: str,
        first_observed_read_at: str,
        source: str,
        confidence: float = 0.5,
    ) -> None:
        existing = self.conn.execute(
            "SELECT id FROM message_reads WHERE chat_id = ? AND msg_id = ?",
            (chat_id, msg_id),
        ).fetchone()
        if existing is None:
            self.conn.execute(
                """INSERT INTO message_reads (
                       chat_id, msg_id, direction, first_observed_read_at, source, confidence
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                (chat_id, msg_id, direction, first_observed_read_at, source, confidence),
            )
        self.conn.execute(
            "UPDATE messages SET read_state = ?, first_observed_read_at = COALESCE(first_observed_read_at, ?) WHERE chat_id = ? AND msg_id = ?",
            ("read_observed", first_observed_read_at, chat_id, msg_id),
        )
        self.conn.commit()

    def list_message_reads(self, chat_id: int, msg_id: int | None = None) -> list[dict[str, Any]]:
        if msg_id is None:
            rows = self.conn.execute(
                "SELECT * FROM message_reads WHERE chat_id = ? ORDER BY first_observed_read_at ASC",
                (chat_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM message_reads WHERE chat_id = ? AND msg_id = ? ORDER BY first_observed_read_at ASC",
                (chat_id, msg_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def replace_message_reactions(
        self,
        *,
        chat_id: int,
        msg_id: int,
        reactions: list[dict[str, Any]],
        observed_at: str,
    ) -> None:
        self.conn.execute(
            "DELETE FROM message_reactions WHERE chat_id = ? AND msg_id = ? AND removed_at IS NULL",
            (chat_id, msg_id),
        )
        for reaction in reactions:
            self.conn.execute(
                """INSERT INTO message_reactions (
                       chat_id, msg_id, reaction, actor_id, observed_at, removed_at
                   ) VALUES (?, ?, ?, ?, ?, NULL)""",
                (
                    chat_id,
                    msg_id,
                    reaction.get("reaction"),
                    reaction.get("actor_id"),
                    observed_at,
                ),
            )
        emoji_summary = ", ".join(reaction.get("reaction", "") for reaction in reactions if reaction.get("reaction"))
        self.conn.execute(
            "UPDATE messages SET reaction_count = ?, emoji_summary = ?, last_observed_at = ? WHERE chat_id = ? AND msg_id = ?",
            (len(reactions), emoji_summary or None, observed_at, chat_id, msg_id),
        )
        self.conn.commit()

    def list_message_reactions(self, chat_id: int, msg_id: int | None = None) -> list[dict[str, Any]]:
        if msg_id is None:
            rows = self.conn.execute(
                "SELECT * FROM message_reactions WHERE chat_id = ? ORDER BY observed_at ASC, id ASC",
                (chat_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM message_reactions WHERE chat_id = ? AND msg_id = ? ORDER BY observed_at ASC, id ASC",
                (chat_id, msg_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def upsert_sync_state(self, chat_id: int, **fields: Any) -> None:
        existing = self.conn.execute(
            "SELECT * FROM sync_state WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()
        if existing is None:
            self.conn.execute(
                """INSERT INTO sync_state (
                       chat_id, last_msg_id, last_pts, last_qts, last_date,
                       last_full_scan_at, last_listener_heartbeat_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    chat_id,
                    fields.get("last_msg_id"),
                    fields.get("last_pts"),
                    fields.get("last_qts"),
                    fields.get("last_date"),
                    fields.get("last_full_scan_at"),
                    fields.get("last_listener_heartbeat_at"),
                ),
            )
        else:
            self.conn.execute(
                """UPDATE sync_state SET
                       last_msg_id = COALESCE(?, last_msg_id),
                       last_pts = COALESCE(?, last_pts),
                       last_qts = COALESCE(?, last_qts),
                       last_date = COALESCE(?, last_date),
                       last_full_scan_at = COALESCE(?, last_full_scan_at),
                       last_listener_heartbeat_at = COALESCE(?, last_listener_heartbeat_at)
                   WHERE chat_id = ?""",
                (
                    fields.get("last_msg_id"),
                    fields.get("last_pts"),
                    fields.get("last_qts"),
                    fields.get("last_date"),
                    fields.get("last_full_scan_at"),
                    fields.get("last_listener_heartbeat_at"),
                    chat_id,
                ),
            )
        self.conn.commit()

    def get_sync_state(self, chat_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM sync_state WHERE chat_id = ?", (chat_id,)).fetchone()
        return dict(row) if row else None

    def upsert_subject(
        self,
        *,
        subject_id: str,
        platform: str = "telegram",
        external_id: str | None = None,
        display_name: str | None = None,
        first_seen_at: str | None = None,
        last_seen_at: str | None = None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO subjects (
                   subject_id, platform, external_id, display_name, first_seen_at, last_seen_at
               ) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(subject_id) DO UPDATE SET
                   platform = excluded.platform,
                   external_id = COALESCE(excluded.external_id, subjects.external_id),
                   display_name = COALESCE(excluded.display_name, subjects.display_name),
                   first_seen_at = COALESCE(subjects.first_seen_at, excluded.first_seen_at),
                   last_seen_at = COALESCE(excluded.last_seen_at, subjects.last_seen_at)""",
            (subject_id, platform, external_id, display_name, first_seen_at, last_seen_at),
        )
        self.conn.commit()

    def get_subject(self, subject_id: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM subjects WHERE subject_id = ?", (subject_id,)).fetchone()
        return dict(row) if row else None

    def insert_subject_alias(
        self,
        *,
        subject_id: str,
        alias_type: str,
        alias_value: str,
        first_seen_at: str,
        last_seen_at: str,
        source_msg_id: int | None = None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO subject_aliases (
                   subject_id, alias_type, alias_value, first_seen_at, last_seen_at, source_msg_id
               ) VALUES (?, ?, ?, ?, ?, ?)""",
            (subject_id, alias_type, alias_value, first_seen_at, last_seen_at, source_msg_id),
        )
        self.conn.commit()

    def list_subject_aliases(self, subject_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM subject_aliases WHERE subject_id = ? ORDER BY last_seen_at ASC, id ASC",
            (subject_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def insert_subject_observation(
        self,
        *,
        subject_id: str,
        chat_id: int,
        field: str,
        value: str,
        explicitly_stated: bool,
        confidence: float,
        observed_at: str,
        source_msg_id: int,
        notes: str | None = None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO subject_observations (
                   subject_id, chat_id, field, value, explicitly_stated, confidence,
                   observed_at, source_msg_id, notes
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                subject_id,
                chat_id,
                field,
                value,
                int(bool(explicitly_stated)),
                confidence,
                observed_at,
                source_msg_id,
                notes,
            ),
        )
        self.conn.commit()

    def list_subject_observations(
        self,
        *,
        subject_id: str | None = None,
        chat_id: int | None = None,
        field: str | None = None,
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM subject_observations WHERE 1=1"
        params: list[Any] = []
        if subject_id is not None:
            query += " AND subject_id = ?"
            params.append(subject_id)
        if chat_id is not None:
            query += " AND chat_id = ?"
            params.append(chat_id)
        if field is not None:
            query += " AND field = ?"
            params.append(field)
        query += " ORDER BY observed_at ASC, id ASC"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def upsert_subject_assertion(
        self,
        *,
        assertion_id: str,
        subject_id: str,
        chat_id: int,
        field: str,
        value: str,
        status: str,
        confidence: float,
        valid_from_ts: str | None,
        valid_to_ts: str | None,
        first_seen_at: str,
        last_seen_at: str,
        supersedes_assertion_id: str | None,
        source_type: str,
        notes: str | None = None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO subject_assertions (
                   assertion_id, subject_id, chat_id, field, value, status, confidence,
                   valid_from_ts, valid_to_ts, first_seen_at, last_seen_at,
                   supersedes_assertion_id, source_type, notes
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(assertion_id) DO UPDATE SET
                   status = excluded.status,
                   confidence = excluded.confidence,
                   valid_from_ts = excluded.valid_from_ts,
                   valid_to_ts = excluded.valid_to_ts,
                   last_seen_at = excluded.last_seen_at,
                   supersedes_assertion_id = excluded.supersedes_assertion_id,
                   notes = excluded.notes""",
            (
                assertion_id,
                subject_id,
                chat_id,
                field,
                value,
                status,
                confidence,
                valid_from_ts,
                valid_to_ts,
                first_seen_at,
                last_seen_at,
                supersedes_assertion_id,
                source_type,
                notes,
            ),
        )
        self.conn.commit()

    def link_assertion_evidence(
        self,
        *,
        assertion_id: str,
        source_msg_id: int,
        evidence_type: str,
        observed_at: str,
    ) -> None:
        self.conn.execute(
            """INSERT INTO assertion_evidence (
                   assertion_id, source_msg_id, evidence_type, observed_at
               ) VALUES (?, ?, ?, ?)""",
            (assertion_id, source_msg_id, evidence_type, observed_at),
        )
        self.conn.commit()

    def get_active_assertions(self, subject_id: str, field: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM subject_assertions WHERE subject_id = ? AND status = 'active'"
        params: list[Any] = [subject_id]
        if field is not None:
            query += " AND field = ?"
            params.append(field)
        query += " ORDER BY last_seen_at DESC, assertion_id ASC"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def get_assertions_as_of(self, subject_id: str, field: str, as_of: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """SELECT * FROM subject_assertions
               WHERE subject_id = ?
                 AND field = ?
                 AND first_seen_at <= ?
                 AND (valid_to_ts IS NULL OR valid_to_ts >= ?)
               ORDER BY last_seen_at DESC, assertion_id ASC""",
            (subject_id, field, as_of, as_of),
        ).fetchall()
        return [dict(row) for row in rows]

    def list_assertion_evidence(self, assertion_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM assertion_evidence WHERE assertion_id = ? ORDER BY observed_at ASC, id ASC",
            (assertion_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def upsert_interaction_metric_day(
        self,
        *,
        chat_id: int,
        subject_id: str,
        day: str,
        sent_count: int,
        reply_count: int,
        reaction_count: int,
        edit_count: int,
        delete_count: int,
        avg_response_latency_sec: float | None,
        avg_read_latency_sec: float | None,
        emoji_count: int,
        top_emojis_json: list[str] | None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO interaction_metrics_daily (
                   chat_id, subject_id, day, sent_count, reply_count, reaction_count,
                   edit_count, delete_count, avg_response_latency_sec, avg_read_latency_sec,
                   emoji_count, top_emojis_json
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chat_id, subject_id, day) DO UPDATE SET
                   sent_count = excluded.sent_count,
                   reply_count = excluded.reply_count,
                   reaction_count = excluded.reaction_count,
                   edit_count = excluded.edit_count,
                   delete_count = excluded.delete_count,
                   avg_response_latency_sec = excluded.avg_response_latency_sec,
                   avg_read_latency_sec = excluded.avg_read_latency_sec,
                   emoji_count = excluded.emoji_count,
                   top_emojis_json = excluded.top_emojis_json""",
            (
                chat_id,
                subject_id,
                day,
                sent_count,
                reply_count,
                reaction_count,
                edit_count,
                delete_count,
                avg_response_latency_sec,
                avg_read_latency_sec,
                emoji_count,
                _json_dumps(top_emojis_json),
            ),
        )
        self.conn.commit()

    def list_interaction_metrics_daily(self, chat_id: int, subject_id: str | None = None) -> list[dict[str, Any]]:
        if subject_id is None:
            rows = self.conn.execute(
                "SELECT * FROM interaction_metrics_daily WHERE chat_id = ? ORDER BY day ASC, id ASC",
                (chat_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM interaction_metrics_daily WHERE chat_id = ? AND subject_id = ? ORDER BY day ASC, id ASC",
                (chat_id, subject_id),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            if item.get("top_emojis_json"):
                item["top_emojis_json"] = json.loads(item["top_emojis_json"])
            result.append(item)
        return result

    def insert_interaction_pattern(
        self,
        *,
        chat_id: int,
        subject_id: str,
        pattern_type: str,
        summary: str,
        confidence: float,
        first_seen_at: str,
        last_seen_at: str,
        evidence_json: list[dict[str, Any]],
    ) -> None:
        self.conn.execute(
            """INSERT INTO interaction_patterns (
                   chat_id, subject_id, pattern_type, summary, confidence,
                   first_seen_at, last_seen_at, evidence_json
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                chat_id,
                subject_id,
                pattern_type,
                summary,
                confidence,
                first_seen_at,
                last_seen_at,
                _json_dumps(evidence_json),
            ),
        )
        self.conn.commit()

    def list_interaction_patterns(self, chat_id: int, subject_id: str | None = None) -> list[dict[str, Any]]:
        if subject_id is None:
            rows = self.conn.execute(
                "SELECT * FROM interaction_patterns WHERE chat_id = ? ORDER BY last_seen_at ASC, id ASC",
                (chat_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM interaction_patterns WHERE chat_id = ? AND subject_id = ? ORDER BY last_seen_at ASC, id ASC",
                (chat_id, subject_id),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            if item.get("evidence_json"):
                item["evidence_json"] = json.loads(item["evidence_json"])
            result.append(item)
        return result

    def upsert_embedding_document(
        self,
        *,
        doc_id: str,
        chat_id: int,
        subject_id: str | None,
        source_type: str,
        source_id: str,
        content: str,
        created_at: str,
        updated_at: str,
        is_active: bool,
    ) -> None:
        self.conn.execute(
            """INSERT INTO embedding_documents (
                   doc_id, chat_id, subject_id, source_type, source_id, content,
                   created_at, updated_at, is_active
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(doc_id) DO UPDATE SET
                   subject_id = excluded.subject_id,
                   source_type = excluded.source_type,
                   source_id = excluded.source_id,
                   content = excluded.content,
                   updated_at = excluded.updated_at,
                   is_active = excluded.is_active""",
            (
                doc_id,
                chat_id,
                subject_id,
                source_type,
                source_id,
                content,
                created_at,
                updated_at,
                int(bool(is_active)),
            ),
        )
        self.conn.commit()

    def list_active_embedding_docs(
        self,
        *,
        chat_id: int | None = None,
        subject_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM embedding_documents WHERE is_active = 1"
        params: list[Any] = []
        if chat_id is not None:
            query += " AND chat_id = ?"
            params.append(chat_id)
        if subject_id is not None:
            query += " AND subject_id = ?"
            params.append(subject_id)
        query += " ORDER BY updated_at ASC, doc_id ASC"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def insert_embedding_vector(
        self,
        *,
        doc_id: str,
        model_id: str,
        vector_blob: bytes,
        created_at: str,
    ) -> None:
        self.conn.execute(
            "INSERT INTO embedding_vectors (doc_id, model_id, vector_blob, created_at) VALUES (?, ?, ?, ?)",
            (doc_id, model_id, vector_blob, created_at),
        )
        self.conn.commit()

    def upsert_ontology_entity(
        self,
        *,
        entity_id: str,
        entity_type: str,
        label: str,
        status: str | None,
        created_at: str,
        updated_at: str,
    ) -> None:
        self.conn.execute(
            """INSERT INTO ontology_entities (
                   entity_id, entity_type, label, status, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(entity_id) DO UPDATE SET
                   entity_type = excluded.entity_type,
                   label = excluded.label,
                   status = excluded.status,
                   updated_at = excluded.updated_at""",
            (entity_id, entity_type, label, status, created_at, updated_at),
        )
        self.conn.commit()

    def upsert_ontology_relation(
        self,
        *,
        relation_id: str,
        subject_entity_id: str,
        predicate: str,
        object_entity_id: str | None,
        object_value: str | None,
        confidence: float,
        status: str,
        valid_from_ts: str | None,
        valid_to_ts: str | None,
        created_at: str,
        updated_at: str,
    ) -> None:
        self.conn.execute(
            """INSERT INTO ontology_relations (
                   relation_id, subject_entity_id, predicate, object_entity_id, object_value,
                   confidence, status, valid_from_ts, valid_to_ts, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(relation_id) DO UPDATE SET
                   predicate = excluded.predicate,
                   object_entity_id = excluded.object_entity_id,
                   object_value = excluded.object_value,
                   confidence = excluded.confidence,
                   status = excluded.status,
                   valid_from_ts = excluded.valid_from_ts,
                   valid_to_ts = excluded.valid_to_ts,
                   updated_at = excluded.updated_at""",
            (
                relation_id,
                subject_entity_id,
                predicate,
                object_entity_id,
                object_value,
                confidence,
                status,
                valid_from_ts,
                valid_to_ts,
                created_at,
                updated_at,
            ),
        )
        self.conn.commit()

    def link_ontology_evidence(
        self,
        *,
        relation_id: str,
        source_msg_id: int,
        evidence_type: str,
        observed_at: str,
    ) -> None:
        self.conn.execute(
            "INSERT INTO ontology_evidence (relation_id, source_msg_id, evidence_type, observed_at) VALUES (?, ?, ?, ?)",
            (relation_id, source_msg_id, evidence_type, observed_at),
        )
        self.conn.commit()

    def list_ontology_relations(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM ontology_relations ORDER BY updated_at ASC, relation_id ASC").fetchall()
        return [dict(row) for row in rows]

    def list_ontology_evidence(self, relation_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM ontology_evidence WHERE relation_id = ? ORDER BY observed_at ASC, id ASC",
            (relation_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def insert_media_asset(
        self,
        *,
        chat_id: int,
        msg_id: int,
        media_kind: str,
        mime_type: str | None,
        size_bytes: int | None,
        file_path: str | None,
        downloaded_at: str | None,
        sha256: str | None,
        status: str,
        error: str | None,
    ) -> int:
        cursor = self.conn.execute(
            """INSERT INTO media_assets (
                   chat_id, msg_id, media_kind, mime_type, size_bytes, file_path,
                   downloaded_at, sha256, status, error
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                chat_id,
                msg_id,
                media_kind,
                mime_type,
                size_bytes,
                file_path,
                downloaded_at,
                sha256,
                status,
                error,
            ),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def list_media_assets(self, *, chat_id: int | None = None) -> list[dict[str, Any]]:
        if chat_id is None:
            rows = self.conn.execute("SELECT * FROM media_assets ORDER BY id ASC").fetchall()
        else:
            rows = self.conn.execute("SELECT * FROM media_assets WHERE chat_id = ? ORDER BY id ASC", (chat_id,)).fetchall()
        return [dict(row) for row in rows]

    def insert_media_transcript(
        self,
        *,
        chat_id: int,
        msg_id: int,
        asset_id: int | None,
        engine: str | None,
        language: str | None,
        transcript_text: str | None,
        segments_json: list[dict[str, Any]] | None,
        confidence: float | None,
        created_at: str | None,
        sent_to_owner_at: str | None,
        status: str,
        error: str | None,
    ) -> int:
        cursor = self.conn.execute(
            """INSERT INTO media_transcripts (
                   chat_id, msg_id, asset_id, engine, language, transcript_text,
                   segments_json, confidence, created_at, sent_to_owner_at, status, error
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                chat_id,
                msg_id,
                asset_id,
                engine,
                language,
                transcript_text,
                _json_dumps(segments_json),
                confidence,
                created_at,
                sent_to_owner_at,
                status,
                error,
            ),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def list_media_transcripts(self, *, chat_id: int | None = None) -> list[dict[str, Any]]:
        if chat_id is None:
            rows = self.conn.execute("SELECT * FROM media_transcripts ORDER BY id ASC").fetchall()
        else:
            rows = self.conn.execute("SELECT * FROM media_transcripts WHERE chat_id = ? ORDER BY id ASC", (chat_id,)).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            if item.get("segments_json"):
                item["segments_json"] = json.loads(item["segments_json"])
            result.append(item)
        return result

    def upsert_export_config_profile(
        self,
        *,
        user_id: str,
        default_scope: str,
        include_media: bool,
        media_kinds_json: list[str],
        max_file_size_bytes: int,
        since_ts: str | None,
        until_ts: str | None,
        updated_at: str,
    ) -> None:
        self.conn.execute(
            """INSERT INTO export_config_profiles (
                   user_id, default_scope, include_media, media_kinds_json,
                   max_file_size_bytes, since_ts, until_ts, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                   default_scope = excluded.default_scope,
                   include_media = excluded.include_media,
                   media_kinds_json = excluded.media_kinds_json,
                   max_file_size_bytes = excluded.max_file_size_bytes,
                   since_ts = excluded.since_ts,
                   until_ts = excluded.until_ts,
                   updated_at = excluded.updated_at""",
            (
                user_id,
                default_scope,
                int(bool(include_media)),
                _json_dumps(media_kinds_json),
                max_file_size_bytes,
                since_ts,
                until_ts,
                updated_at,
            ),
        )
        self.conn.commit()

    def get_export_config_profile(self, user_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM export_config_profiles WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        item = dict(row)
        if item.get("media_kinds_json"):
            item["media_kinds_json"] = json.loads(item["media_kinds_json"])
        return item

    def upsert_export_scope_default(self, *, user_id: str, scope_name: str, enabled: bool) -> None:
        self.conn.execute(
            """INSERT INTO export_scope_defaults (user_id, scope_name, enabled)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id, scope_name) DO UPDATE SET enabled = excluded.enabled""",
            (user_id, scope_name, int(bool(enabled))),
        )
        self.conn.commit()

    def list_export_scope_defaults(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM export_scope_defaults WHERE user_id = ? ORDER BY scope_name ASC",
            (user_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def upsert_export_chat_override(
        self,
        *,
        user_id: str,
        chat_id: int,
        scope_name: str | None,
        enabled: bool,
        updated_at: str,
    ) -> None:
        self.conn.execute(
            """INSERT INTO export_chat_overrides (user_id, chat_id, scope_name, enabled, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id, chat_id) DO UPDATE SET
                   scope_name = excluded.scope_name,
                   enabled = excluded.enabled,
                   updated_at = excluded.updated_at""",
            (user_id, chat_id, scope_name, int(bool(enabled)), updated_at),
        )
        self.conn.commit()

    def list_export_chat_overrides(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM export_chat_overrides WHERE user_id = ? ORDER BY chat_id ASC",
            (user_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_effective_export_config(self, user_id: str) -> dict[str, Any]:
        profile = self.get_export_config_profile(user_id)
        scopes = {row["scope_name"]: bool(row["enabled"]) for row in self.list_export_scope_defaults(user_id)}
        overrides = {row["chat_id"]: {"scope_name": row["scope_name"], "enabled": bool(row["enabled"])} for row in self.list_export_chat_overrides(user_id)}
        return {
            "profile": profile,
            "scopes": scopes,
            "chat_overrides": overrides,
        }

    def upsert_subject_profile(
        self,
        *,
        subject_id: str,
        display_name: str | None,
        username: str | None,
        bio: str | None,
        avatar_ref: str | None,
        tg_external_id: str | None,
        updated_at: str,
    ) -> None:
        self.conn.execute(
            """INSERT INTO subject_profiles (
                   subject_id, display_name, username, bio, avatar_ref, tg_external_id, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(subject_id) DO UPDATE SET
                   display_name = excluded.display_name,
                   username = excluded.username,
                   bio = excluded.bio,
                   avatar_ref = excluded.avatar_ref,
                   tg_external_id = excluded.tg_external_id,
                   updated_at = excluded.updated_at""",
            (subject_id, display_name, username, bio, avatar_ref, tg_external_id, updated_at),
        )
        self.conn.commit()

    def get_subject_profile(self, subject_id: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM subject_profiles WHERE subject_id = ?", (subject_id,)).fetchone()
        return dict(row) if row else None

    def insert_subject_profile_music(
        self,
        *,
        subject_id: str,
        title: str | None,
        performer: str | None,
        file_name: str | None,
        observed_at: str,
    ) -> None:
        self.conn.execute(
            "INSERT INTO subject_profile_music (subject_id, title, performer, file_name, observed_at) VALUES (?, ?, ?, ?, ?)",
            (subject_id, title, performer, file_name, observed_at),
        )
        self.conn.commit()

    def list_subject_profile_music(self, subject_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM subject_profile_music WHERE subject_id = ? ORDER BY observed_at ASC, id ASC",
            (subject_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def insert_subject_profile_link(
        self,
        *,
        subject_id: str,
        link_type: str,
        label: str | None,
        url: str | None,
        observed_at: str,
    ) -> None:
        self.conn.execute(
            "INSERT INTO subject_profile_links (subject_id, link_type, label, url, observed_at) VALUES (?, ?, ?, ?, ?)",
            (subject_id, link_type, label, url, observed_at),
        )
        self.conn.commit()

    def list_subject_profile_links(self, subject_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM subject_profile_links WHERE subject_id = ? ORDER BY observed_at ASC, id ASC",
            (subject_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def insert_message_media(
        self,
        *,
        chat_id: int,
        msg_id: int,
        media_type: str,
        title: str | None,
        performer: str | None,
        duration_sec: float | None,
        file_name: str | None,
        mime_type: str | None,
        caption: str | None,
        observed_at: str,
    ) -> None:
        self.conn.execute(
            """INSERT INTO message_media (
                   chat_id, msg_id, media_type, title, performer, duration_sec,
                   file_name, mime_type, caption, observed_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (chat_id, msg_id, media_type, title, performer, duration_sec, file_name, mime_type, caption, observed_at),
        )
        self.conn.commit()

    def list_message_media(self, *, chat_id: int | None = None) -> list[dict[str, Any]]:
        if chat_id is None:
            rows = self.conn.execute("SELECT * FROM message_media ORDER BY id ASC").fetchall()
        else:
            rows = self.conn.execute("SELECT * FROM message_media WHERE chat_id = ? ORDER BY id ASC", (chat_id,)).fetchall()
        return [dict(row) for row in rows]

    def insert_message_repost(
        self,
        *,
        chat_id: int,
        msg_id: int,
        source_type: str,
        source_id: str | None,
        source_name: str | None,
        forwarded_date: str | None,
        observed_at: str,
    ) -> None:
        self.conn.execute(
            "INSERT INTO message_reposts (chat_id, msg_id, source_type, source_id, source_name, forwarded_date, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (chat_id, msg_id, source_type, source_id, source_name, forwarded_date, observed_at),
        )
        self.conn.commit()

    def list_message_reposts(self, *, chat_id: int | None = None) -> list[dict[str, Any]]:
        if chat_id is None:
            rows = self.conn.execute("SELECT * FROM message_reposts ORDER BY id ASC").fetchall()
        else:
            rows = self.conn.execute("SELECT * FROM message_reposts WHERE chat_id = ? ORDER BY id ASC", (chat_id,)).fetchall()
        return [dict(row) for row in rows]

    def search(
        self,
        keyword: str,
        chat_id: int | None = None,
        sender: str | None = None,
        hours: int | None = None,
        limit: int = 50,
    ) -> list[dict]:
        query = "SELECT * FROM messages WHERE content LIKE ?"
        params: list[Any] = [f"%{keyword}%"]
        if chat_id is not None:
            query += " AND chat_id = ?"
            params.append(chat_id)
        if sender is not None:
            query += " AND sender_name LIKE ?"
            params.append(f"%{sender}%")
        if hours is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
            query += " AND timestamp >= ?"
            params.append(cutoff)
        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def search_regex(
        self,
        pattern: str,
        chat_id: int | None = None,
        sender: str | None = None,
        hours: int | None = None,
        limit: int = 50,
    ) -> list[dict]:
        regex = re.compile(pattern, re.IGNORECASE)
        query = "SELECT * FROM messages WHERE content IS NOT NULL"
        params: list[Any] = []
        if chat_id is not None:
            query += " AND chat_id = ?"
            params.append(chat_id)
        if sender is not None:
            query += " AND sender_name LIKE ?"
            params.append(f"%{sender}%")
        if hours is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
            query += " AND timestamp >= ?"
            params.append(cutoff)
        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit * 10)
        rows = self.conn.execute(query, params).fetchall()
        results: list[dict] = []
        for row in rows:
            msg = dict(row)
            content = msg.get("content") or ""
            if regex.search(content):
                results.append(msg)
                if len(results) >= limit:
                    break
        return results

    def get_recent(
        self,
        chat_id: int | None = None,
        sender: str | None = None,
        hours: int | None = 24,
        limit: int = 500,
    ) -> list[dict]:
        if hours is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
            base_query = "SELECT * FROM messages WHERE timestamp >= ?"
            params: list[Any] = [cutoff]
        else:
            base_query = "SELECT * FROM messages WHERE 1=1"
            params = []
        if chat_id is not None:
            base_query += " AND chat_id = ?"
            params.append(chat_id)
        if sender is not None:
            base_query += " AND sender_name LIKE ?"
            params.append(f"%{sender}%")
        query = f"SELECT * FROM ({base_query} ORDER BY timestamp DESC, msg_id DESC LIMIT ?) ORDER BY timestamp ASC, msg_id ASC"
        rows = self.conn.execute(query, params + [limit]).fetchall()
        return [dict(r) for r in rows]

    def get_today(
        self,
        chat_id: int | None = None,
        tz_offset_hours: int | None = None,
        limit: int = 5000,
    ) -> list[dict]:
        now_utc = datetime.now(timezone.utc)
        if tz_offset_hours is not None:
            local_tz = timezone(timedelta(hours=tz_offset_hours))
        else:
            local_tz = datetime.now().astimezone().tzinfo
        today_local = now_utc.astimezone(local_tz).replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff_utc = today_local.astimezone(timezone.utc).isoformat()

        query = "SELECT * FROM messages WHERE timestamp >= ?"
        params: list[Any] = [cutoff_utc]
        if chat_id is not None:
            query += " AND chat_id = ?"
            params.append(chat_id)
        query += " ORDER BY chat_name, timestamp ASC, msg_id ASC LIMIT ?"
        params.append(limit)
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def get_chat_messages(self, chat_id: int, limit: int | None = None) -> list[dict]:
        query = "SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC, msg_id ASC"
        params: list[Any] = [chat_id]
        if limit is not None:
            query += " LIMIT ?"
            params.append(limit)
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def get_chats(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT chat_id, chat_name, COUNT(*) as msg_count,
                      MIN(timestamp) as first_msg, MAX(timestamp) as last_msg
               FROM messages
               GROUP BY chat_id
               ORDER BY msg_count DESC"""
        ).fetchall()
        return [dict(r) for r in rows]

    def get_last_msg_id(self, chat_id: int) -> int | None:
        row = self.conn.execute("SELECT MAX(msg_id) FROM messages WHERE chat_id = ?", (chat_id,)).fetchone()
        return row[0] if row and row[0] is not None else None

    def count(self, chat_id: int | None = None) -> int:
        if chat_id is not None:
            row = self.conn.execute("SELECT COUNT(*) FROM messages WHERE chat_id = ?", (chat_id,)).fetchone()
        else:
            row = self.conn.execute("SELECT COUNT(*) FROM messages").fetchone()
        return row[0]

    def get_latest_timestamp(self, chat_id: int | None = None) -> str | None:
        if chat_id is not None:
            row = self.conn.execute("SELECT MAX(timestamp) FROM messages WHERE chat_id = ?", (chat_id,)).fetchone()
        else:
            row = self.conn.execute("SELECT MAX(timestamp) FROM messages").fetchone()
        return row[0] if row and row[0] is not None else None

    def delete_chat(self, chat_id: int) -> int:
        cursor = self.conn.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
        self.conn.commit()
        return cursor.rowcount

    def top_senders(
        self,
        chat_id: int | None = None,
        hours: int | None = None,
        limit: int = 20,
    ) -> list[dict]:
        conditions = ["(sender_id IS NOT NULL OR sender_name IS NOT NULL)"]
        params: list[Any] = []
        if chat_id is not None:
            conditions.append("chat_id = ?")
            params.append(chat_id)
        if hours is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
            conditions.append("timestamp >= ?")
            params.append(cutoff)
        where = " AND ".join(conditions)
        rows = self.conn.execute(
            f"""SELECT MAX(sender_name) as sender_name, sender_id, COUNT(*) as msg_count,
                       MIN(timestamp) as first_msg, MAX(timestamp) as last_msg
                FROM messages WHERE {where}
                GROUP BY COALESCE(CAST(sender_id AS TEXT), 'name:' || COALESCE(sender_name, ''))
                ORDER BY msg_count DESC
                LIMIT ?""",
            params + [limit],
        ).fetchall()
        return [dict(r) for r in rows]

    def timeline(
        self,
        chat_id: int | None = None,
        hours: int | None = None,
        granularity: str = "day",
    ) -> list[dict]:
        time_expr = "substr(timestamp, 1, 13)" if granularity == "hour" else "substr(timestamp, 1, 10)"
        conditions = ["1=1"]
        params: list[Any] = []
        if chat_id is not None:
            conditions.append("chat_id = ?")
            params.append(chat_id)
        if hours is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
            conditions.append("timestamp >= ?")
            params.append(cutoff)
        where = " AND ".join(conditions)
        rows = self.conn.execute(
            f"""SELECT {time_expr} as period, COUNT(*) as msg_count
                FROM messages WHERE {where}
                GROUP BY period
                ORDER BY period ASC""",
            params,
        ).fetchall()
        return [dict(r) for r in rows]

    def upsert_dialog_session(self, session: dict[str, Any]) -> None:
        self.conn.execute(
            """INSERT INTO dialog_sessions (
                   session_id, platform, chat_id, chat_name, dialog_type,
                   first_msg_ts, last_msg_ts, message_count, segment_count,
                   last_raw_msg_id, last_built_at, compacted_msg_id, last_compaction_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chat_id) DO UPDATE SET
                   session_id = excluded.session_id,
                   platform = excluded.platform,
                   chat_name = excluded.chat_name,
                   dialog_type = excluded.dialog_type,
                   first_msg_ts = excluded.first_msg_ts,
                   last_msg_ts = excluded.last_msg_ts,
                   message_count = excluded.message_count,
                   segment_count = excluded.segment_count,
                   last_raw_msg_id = excluded.last_raw_msg_id,
                   last_built_at = excluded.last_built_at,
                   compacted_msg_id = excluded.compacted_msg_id,
                   last_compaction_at = excluded.last_compaction_at""",
            (
                session["session_id"],
                session.get("platform", "telegram"),
                session["chat_id"],
                session.get("chat_name"),
                session.get("dialog_type"),
                session.get("first_msg_ts"),
                session.get("last_msg_ts"),
                session.get("message_count", 0),
                session.get("segment_count", 0),
                session.get("last_raw_msg_id"),
                session["last_built_at"],
                session.get("compacted_msg_id"),
                session.get("last_compaction_at"),
            ),
        )
        self.conn.commit()

    def replace_dialog_segments(self, chat_id: int, segments: list[dict[str, Any]]) -> None:
        self.conn.execute("DELETE FROM dialog_segments WHERE chat_id = ?", (chat_id,))
        if segments:
            rows = [
                (
                    seg["segment_id"],
                    seg["session_id"],
                    chat_id,
                    seg["seq"],
                    seg["start_msg_id"],
                    seg["end_msg_id"],
                    seg["start_ts"],
                    seg["end_ts"],
                    seg["message_count"],
                    seg.get("dominant_sender"),
                    seg.get("topic_hint"),
                    seg.get("summary"),
                    seg.get("status", "active"),
                )
                for seg in segments
            ]
            self.conn.executemany(
                """INSERT INTO dialog_segments (
                       segment_id, session_id, chat_id, seq, start_msg_id, end_msg_id,
                       start_ts, end_ts, message_count, dominant_sender, topic_hint,
                       summary, status
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
        self.conn.commit()

    def replace_dialog_summaries(self, chat_id: int, summaries: list[dict[str, Any]]) -> None:
        self.conn.execute("DELETE FROM dialog_summaries WHERE chat_id = ?", (chat_id,))
        if summaries:
            rows = [
                (
                    summary["summary_id"],
                    summary["session_id"],
                    chat_id,
                    summary.get("segment_id"),
                    summary["kind"],
                    summary["summary"],
                    _json_dumps(summary.get("payload_json")),
                    summary["created_at"],
                )
                for summary in summaries
            ]
            self.conn.executemany(
                """INSERT INTO dialog_summaries (
                       summary_id, session_id, chat_id, segment_id, kind, summary,
                       payload_json, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
        self.conn.commit()

    def replace_dialog_facts(self, chat_id: int, facts: list[dict[str, Any]]) -> None:
        self.conn.execute("DELETE FROM dialog_facts WHERE chat_id = ?", (chat_id,))
        if facts:
            rows = [
                (
                    fact["fact_id"],
                    fact["session_id"],
                    chat_id,
                    fact["fact_type"],
                    fact.get("subject"),
                    fact["predicate"],
                    fact.get("object"),
                    _json_dumps(fact.get("value_json")),
                    fact.get("confidence", 0.0),
                    fact.get("status", "active"),
                    fact["created_at"],
                )
                for fact in facts
            ]
            self.conn.executemany(
                """INSERT INTO dialog_facts (
                       fact_id, session_id, chat_id, fact_type, subject, predicate,
                       object, value_json, confidence, status, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
        self.conn.commit()

    def replace_dialog_evidence(self, chat_id: int, evidence: list[dict[str, Any]]) -> None:
        self.conn.execute("DELETE FROM dialog_evidence WHERE chat_id = ?", (chat_id,))
        if evidence:
            rows = [
                (
                    item["session_id"],
                    chat_id,
                    item["owner_type"],
                    item["owner_id"],
                    item["msg_id"],
                    item.get("note"),
                )
                for item in evidence
            ]
            self.conn.executemany(
                """INSERT INTO dialog_evidence (
                       session_id, chat_id, owner_type, owner_id, msg_id, note
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                rows,
            )
        self.conn.commit()

    def insert_dialog_compaction(self, compaction: dict[str, Any]) -> None:
        self.conn.execute(
            """INSERT INTO dialog_compactions (
                   compaction_id, session_id, chat_id, summary_id,
                   covered_until_msg_id, preserved_tail_count, policy_json, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                compaction["compaction_id"],
                compaction["session_id"],
                compaction["chat_id"],
                compaction.get("summary_id"),
                compaction.get("covered_until_msg_id"),
                compaction.get("preserved_tail_count", 0),
                _json_dumps(compaction.get("policy_json")),
                compaction["created_at"],
            ),
        )
        self.conn.commit()

    def get_dialog_session(self, chat_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM dialog_sessions WHERE chat_id = ?", (chat_id,)).fetchone()
        return dict(row) if row else None

    def list_dialog_sessions(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM dialog_sessions ORDER BY COALESCE(last_msg_ts, '') DESC, chat_id ASC"
        ).fetchall()
        return [dict(row) for row in rows]

    def get_dialog_segments(self, chat_id: int) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM dialog_segments WHERE chat_id = ? ORDER BY seq ASC", (chat_id,)).fetchall()
        return [dict(row) for row in rows]

    def get_dialog_summaries(self, chat_id: int, kind: str | None = None) -> list[dict[str, Any]]:
        if kind is None:
            rows = self.conn.execute(
                "SELECT * FROM dialog_summaries WHERE chat_id = ? ORDER BY created_at ASC",
                (chat_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM dialog_summaries WHERE chat_id = ? AND kind = ? ORDER BY created_at ASC",
                (chat_id, kind),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            if item.get("payload_json"):
                item["payload_json"] = json.loads(item["payload_json"])
            result.append(item)
        return result

    def get_dialog_facts(self, chat_id: int, fact_type: str | None = None) -> list[dict[str, Any]]:
        if fact_type is None:
            rows = self.conn.execute(
                "SELECT * FROM dialog_facts WHERE chat_id = ? ORDER BY confidence DESC, created_at ASC",
                (chat_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM dialog_facts WHERE chat_id = ? AND fact_type = ? ORDER BY confidence DESC, created_at ASC",
                (chat_id, fact_type),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            if item.get("value_json"):
                item["value_json"] = json.loads(item["value_json"])
            result.append(item)
        return result

    def get_dialog_evidence(
        self,
        chat_id: int,
        *,
        owner_type: str | None = None,
        owner_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM dialog_evidence WHERE chat_id = ?"
        params: list[Any] = [chat_id]
        if owner_type is not None:
            query += " AND owner_type = ?"
            params.append(owner_type)
        if owner_id is not None:
            query += " AND owner_id = ?"
            params.append(owner_id)
        query += " ORDER BY id ASC"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def get_dialog_compactions(self, chat_id: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM dialog_compactions WHERE chat_id = ? ORDER BY created_at ASC",
            (chat_id,),
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            if item.get("policy_json"):
                item["policy_json"] = json.loads(item["policy_json"])
            result.append(item)
        return result

    def reset_dialog_session_state(self, chat_id: int) -> None:
        self.conn.execute("DELETE FROM dialog_segments WHERE chat_id = ?", (chat_id,))
        self.conn.execute("DELETE FROM dialog_summaries WHERE chat_id = ?", (chat_id,))
        self.conn.execute("DELETE FROM dialog_facts WHERE chat_id = ?", (chat_id,))
        self.conn.execute("DELETE FROM dialog_evidence WHERE chat_id = ?", (chat_id,))
        self.conn.execute("DELETE FROM dialog_compactions WHERE chat_id = ?", (chat_id,))
        self.conn.execute("DELETE FROM dialog_sessions WHERE chat_id = ?", (chat_id,))
        self.conn.commit()

    def close(self):
        self.conn.close()
