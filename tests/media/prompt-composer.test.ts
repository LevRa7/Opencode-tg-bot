import { describe, expect, it } from "vitest";

import type {
  CorrelatedIncomingItem,
  ResolvedDeferredItem,
  TranslateFn,
} from "../../src/media/batch-types.js";
import { composeDeferredMediaPrompt } from "../../src/media/prompt-composer.js";

const t: TranslateFn = (key: string, params?: Record<string, string | number>): string => {
  const values: Record<string, string | ((p?: Record<string, string | number>) => string)> = {
    "deferred.forwarded.from_display": (p) => `[Forwarded from: ${p?.displayName ?? ""}]`,
    "deferred.forwarded.from_another_user": "[Forwarded from another user]",
    "deferred.forwarded.generic": "[Forwarded message]",
    "deferred.kind.photo": "Photo",
    "deferred.kind.document": "Document",
    "deferred.kind.audio": "Audio",
    "deferred.kind.video": "Video",
    "deferred.kind.text": "Text",
    "deferred.preview.label_one": "message",
    "deferred.preview.label_other": "messages",
    "deferred.preview.header": (p) => `Recognized from ${p?.count} ${p?.label}:\n`,
  };
  const v = values[key];
  return typeof v === "function" ? v(params) : v;
};

describe("media/prompt-composer", () => {
  it("keeps the latest direct user text as the main prompt and moves forwarded text and video into context", () => {
    const items: Array<CorrelatedIncomingItem | ResolvedDeferredItem> = [
      {
        correlationId: "corr-forwarded",
        kind: "text",
        directText: "The upstream API starts timing out after five minutes.",
        previewText: "The upstream API starts timing out after five minutes.",
        forwardedSource: {
          displayName: "Ops Team",
        },
      },
      {
        correlationId: "corr-video",
        kind: "video",
        previewText: "Screen recording with repro steps",
        contextText: "Video summary: open the dashboard, wait five minutes, then retry.",
      },
      {
        correlationId: "corr-direct",
        kind: "text",
        directText: "Please diagnose the timeout regression.",
      },
    ];

    expect(composeDeferredMediaPrompt(items, t)).toEqual({
      directText: "Please diagnose the timeout regression.",
      previewText:
        "Recognized from 2 messages:\n1. [Forwarded from: Ops Team] The upstream API starts timing out after five minutes.\n2. Screen recording with repro steps",
      contextText:
        "Additional context for the user's previous request:\n\n[Forwarded from: Ops Team]\nThe upstream API starts timing out after five minutes.\n\n[Video]\nVideo summary: open the dashboard, wait five minutes, then retry.",
    });
  });

  it("promotes the latest audio transcript into the main prompt when direct text is absent", () => {
    const items: ResolvedDeferredItem[] = [
      {
        correlationId: "corr-audio",
        kind: "audio",
        previewText: "Voice note asking for meeting action items",
        contextText: "List the meeting action items and highlight blockers.",
      },
    ];

    expect(composeDeferredMediaPrompt(items, t)).toEqual({
      directText: "List the meeting action items and highlight blockers.",
      previewText:
        "Recognized from 1 message:\n1. Voice note asking for meeting action items",
      contextText:
        "User request from transcribed audio:\nList the meeting action items and highlight blockers.",
    });
  });

  it("keeps photo and document extraction in context blocks when no direct text exists", () => {
    const items: ResolvedDeferredItem[] = [
      {
        correlationId: "corr-photo",
        kind: "photo",
        previewText: "Photo extraction from the whiteboard",
        contextText: "Whiteboard notes mention the release checklist and rollback plan.",
      },
      {
        correlationId: "corr-document",
        kind: "document",
        previewText: "Document extraction from the requirements file",
        contextText: "The document lists acceptance criteria for retry handling and alerts.",
      },
    ];

    expect(composeDeferredMediaPrompt(items, t)).toEqual({
      previewText:
        "Recognized from 2 messages:\n1. Photo extraction from the whiteboard\n2. Document extraction from the requirements file",
      contextText:
        "Analyze the extracted context below.\n\n[Photo]\nWhiteboard notes mention the release checklist and rollback plan.\n\n[Document]\nThe document lists acceptance criteria for retry handling and alerts.",
    });
  });

  it("preserves both forwarded source and media kind for forwarded video items", () => {
    const items: ResolvedDeferredItem[] = [
      {
        correlationId: "corr-forwarded-video",
        kind: "video",
        previewText: "Walkthrough recording of the failing import flow",
        contextText: "The video shows the import button freezing after the CSV upload finishes.",
        forwardedSource: {
          displayName: "Alice",
        },
      },
    ];

    expect(composeDeferredMediaPrompt(items, t)).toEqual({
      previewText:
        "Recognized from 1 message:\n1. [Forwarded from: Alice] Video: Walkthrough recording of the failing import flow",
      contextText:
        "Analyze the extracted context below.\n\n[Forwarded from: Alice]\n[Video]\nThe video shows the import button freezing after the CSV upload finishes.",
    });
  });
});
