import { describe, expect, it, vi } from "vitest";
import {
  buildTelegramWebhookUrl,
  ensureTelegramWebhook,
  isTelegramWebhookDeliveryUnhealthy,
  normalizeTelegramWebhookPath,
  switchTelegramToPolling,
  TELEGRAM_ALLOWED_UPDATES,
} from "../../src/bot/update-config.js";

describe("telegram update config", () => {
  it("normalizes webhook paths", () => {
    expect(normalizeTelegramWebhookPath("telegram/webhook")).toBe("/telegram/webhook");
    expect(normalizeTelegramWebhookPath("/telegram/webhook")).toBe("/telegram/webhook");
    expect(normalizeTelegramWebhookPath("   ")).toBe("/telegram/webhook");
  });

  it("builds webhook URL from base URL and path", () => {
    expect(
      buildTelegramWebhookUrl({
        baseUrl: "https://smart-server.online/",
        path: "telegram/webhook",
        secret: "secret",
      }),
    ).toBe("https://smart-server.online/telegram/webhook");
  });

  it("sets webhook with allowed update types and secret token", async () => {
    const api = {
      getWebhookInfo: vi.fn().mockResolvedValue({ url: "" }),
      setWebhook: vi.fn().mockResolvedValue(true),
      deleteWebhook: vi.fn().mockResolvedValue(true),
    };

    const url = await ensureTelegramWebhook(api, {
      baseUrl: "https://smart-server.online",
      path: "/telegram/webhook",
      secret: "secret-token",
    });

    expect(url).toBe("https://smart-server.online/telegram/webhook");
    expect(api.setWebhook).toHaveBeenCalledWith("https://smart-server.online/telegram/webhook", {
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      secret_token: "secret-token",
    });
  });

  it("does not reset webhook when it already targets the configured URL", async () => {
    const api = {
      getWebhookInfo: vi.fn().mockResolvedValue({ url: "https://smart-server.online/telegram/webhook" }),
      setWebhook: vi.fn().mockResolvedValue(true),
      deleteWebhook: vi.fn().mockResolvedValue(true),
    };

    await ensureTelegramWebhook(api, {
      baseUrl: "https://smart-server.online",
      path: "/telegram/webhook",
      secret: "secret-token",
    });

    expect(api.setWebhook).not.toHaveBeenCalled();
  });

  it("removes active webhook when switching to polling", async () => {
    const api = {
      getWebhookInfo: vi.fn().mockResolvedValue({ url: "https://smart-server.online/telegram/webhook" }),
      setWebhook: vi.fn().mockResolvedValue(true),
      deleteWebhook: vi.fn().mockResolvedValue(true),
    };

    await switchTelegramToPolling(api);

    expect(api.deleteWebhook).toHaveBeenCalledTimes(1);
  });

  it("detects webhook delivery failures reported after startup", () => {
    expect(
      isTelegramWebhookDeliveryUnhealthy(
        {
          url: "https://smart-server.online/telegram/webhook",
          pending_update_count: 3,
          last_error_date: 1_800,
        },
        1_700,
      ),
    ).toBe(true);
  });

  it("ignores old webhook delivery failures from before startup", () => {
    expect(
      isTelegramWebhookDeliveryUnhealthy(
        {
          url: "https://smart-server.online/telegram/webhook",
          pending_update_count: 3,
          last_error_date: 1_600,
        },
        1_700,
      ),
    ).toBe(false);
  });
});
