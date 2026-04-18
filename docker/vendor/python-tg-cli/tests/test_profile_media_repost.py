"""TDD tests for profile/media/repost storage and extractors."""

from __future__ import annotations

from tg_cli.db import MessageDB
from tg_cli.profile_media_extractors import (
    extract_message_media,
    extract_message_repost,
    extract_profile_snapshot,
)
from tg_cli.session_engine import DialogSessionEngine
from conftest import make_msg


def test_profile_media_repost_tables_exist(db: MessageDB):
    table_names = {
        row[0]
        for row in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "subject_profiles" in table_names
    assert "subject_profile_photos" in table_names
    assert "subject_profile_music" in table_names
    assert "subject_profile_links" in table_names
    assert "message_media" in table_names
    assert "message_reposts" in table_names


def test_profile_snapshot_roundtrip(db: MessageDB):
    db.upsert_subject_profile(
        subject_id="telegram:user:731038050",
        display_name="Снежана",
        username="snezhana",
        bio="bio text",
        avatar_ref="avatars/a.jpg",
        tg_external_id="731038050",
        updated_at="2026-04-04T00:00:00+00:00",
    )
    profile = db.get_subject_profile("telegram:user:731038050")
    assert profile["display_name"] == "Снежана"
    assert profile["username"] == "snezhana"


def test_profile_music_roundtrip(db: MessageDB):
    db.insert_subject_profile_music(
        subject_id="telegram:user:731038050",
        title="Track",
        performer="Artist",
        file_name="track.mp3",
        observed_at="2026-04-04T00:00:00+00:00",
    )
    items = db.list_subject_profile_music("telegram:user:731038050")
    assert items[0]["title"] == "Track"


def test_profile_links_roundtrip(db: MessageDB):
    db.insert_subject_profile_link(
        subject_id="telegram:user:731038050",
        link_type="channel",
        label="My Channel",
        url="https://t.me/example",
        observed_at="2026-04-04T00:00:00+00:00",
    )
    links = db.list_subject_profile_links("telegram:user:731038050")
    assert links[0]["link_type"] == "channel"


def test_message_media_roundtrip(db: MessageDB):
    db.insert_message_media(
        chat_id=100,
        msg_id=2,
        media_type="audio",
        title="Track",
        performer="Artist",
        duration_sec=120,
        file_name="track.mp3",
        mime_type="audio/mpeg",
        caption="caption",
        observed_at="2026-04-04T00:00:00+00:00",
    )
    rows = db.list_message_media(chat_id=100)
    assert rows[0]["media_type"] == "audio"
    assert rows[0]["title"] == "Track"


def test_message_reposts_roundtrip(db: MessageDB):
    db.insert_message_repost(
        chat_id=100,
        msg_id=3,
        source_type="channel",
        source_id="channel123",
        source_name="Source Channel",
        forwarded_date="2026-04-04T00:00:00+00:00",
        observed_at="2026-04-04T00:00:01+00:00",
    )
    rows = db.list_message_reposts(chat_id=100)
    assert rows[0]["source_name"] == "Source Channel"


def test_profile_extractor_extracts_public_profile_fields():
    snapshot = extract_profile_snapshot(
        {
            "first_name": "Снежана",
            "username": "@snezhana",
            "bio": "bio text",
            "photo": "avatars/a.jpg",
            "user_id": 731038050,
        }
    )
    assert snapshot["display_name"] == "Снежана"
    assert snapshot["username"] == "snezhana"


def test_media_extractor_extracts_track_metadata():
    media = extract_message_media(
        {
            "media_type": "audio_file",
            "title": "Concert",
            "performer": "Nicholas Lem",
            "file_name": "concert.mp3",
            "duration_seconds": 3239,
            "mime_type": "audio/mpeg",
            "text": "",
        }
    )
    assert media["media_type"] == "audio"
    assert media["title"] == "Concert"


def test_repost_extractor_extracts_forward_source():
    repost = extract_message_repost(
        {
            "forwarded_from": "Source User",
            "forwarded_from_id": "user123",
            "date": "2026-04-04T00:00:00+00:00",
        }
    )
    assert repost["source_name"] == "Source User"


def test_projection_can_include_profile_media_repost_context(db: MessageDB):
    db.insert_message(**make_msg(msg_id=1, content="hello"))
    db.upsert_subject_profile(
        subject_id="telegram:user:100",
        display_name="Снежана",
        username="snezhana",
        bio="bio text",
        avatar_ref="avatars/a.jpg",
        tg_external_id="100",
        updated_at="2026-04-04T00:00:00+00:00",
    )
    db.insert_subject_profile_music(
        subject_id="telegram:user:100",
        title="Track",
        performer="Artist",
        file_name="track.mp3",
        observed_at="2026-04-04T00:00:00+00:00",
    )
    db.insert_message_repost(
        chat_id=100,
        msg_id=1,
        source_type="channel",
        source_id="channel123",
        source_name="Source Channel",
        forwarded_date="2026-04-04T00:00:00+00:00",
        observed_at="2026-04-04T00:00:01+00:00",
    )
    engine = DialogSessionEngine(db)
    engine.build_for_chat(100)
    projection = engine.build_ask_projection(100, "Что можно понять по профилю и медиа?")
    assert "profile_snapshot" in projection
    assert "media_profile" in projection
    assert "repost_profile" in projection
