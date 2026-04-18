"""Speech-to-text client for configured HTTP transcription endpoint."""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class STTClient:
    endpoint: str

    def transcribe(self, path: Path) -> dict[str, Any]:
        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps({"file_path": str(path)}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as response:  # noqa: S310
            return json.loads(response.read().decode())
