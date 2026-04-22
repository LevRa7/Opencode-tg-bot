import { CommandContext, Context } from "grammy";
import { getRuntimeModelCatalog } from "../../model/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;

function buildProviderPrefix(providerID: string): string {
  return `🔹 ${providerID}\n`;
}

function buildProviderSegments(provider: {
  providerID: string;
  models: Array<{ modelID: string }>;
}, maxSegmentLength: number): string[] {
  const prefix = buildProviderPrefix(provider.providerID);

  if (provider.models.length === 0) {
    return [`${prefix}${t("legacy.models.no_provider_models")}\n`];
  }

  const segments: string[] = [];
  let segment = prefix;

  for (const model of provider.models) {
    const line = `  - ${model.modelID}\n`;
    const nextSegment = `${segment}${line}`;

    if (segment !== prefix && `${nextSegment}\n`.length > maxSegmentLength) {
      segments.push(`${segment}\n`);
      segment = `${prefix}${line}`;
      continue;
    }

    segment = nextSegment;
  }

  segments.push(`${segment}\n`);
  return segments;
}

function splitCatalogMessages(providers: Array<{ providerID: string; models: Array<{ modelID: string }> }>): string[] {
  const header = t("legacy.models.header");
  const footer = `${t("legacy.models.env_hint")}OPENCODE_MODEL_PROVIDER=<provider.id>\nOPENCODE_MODEL_ID=<model.id>`;
  const maxMessageBodyLength = TELEGRAM_MESSAGE_LIMIT - footer.length;
  const maxProviderSegmentLength = maxMessageBodyLength - header.length;
  const messages: string[] = [];
  let currentMessage = header;

  for (const provider of providers) {
    const providerSegments = buildProviderSegments(provider, maxProviderSegmentLength);

    for (const providerSegment of providerSegments) {
      const nextMessage = `${currentMessage}${providerSegment}`;

      if (currentMessage !== header && nextMessage.length > maxMessageBodyLength) {
        messages.push(currentMessage);
        currentMessage = `${header}${providerSegment}`;
        continue;
      }

      currentMessage = nextMessage;
    }
  }

  messages.push(`${currentMessage}${footer}`);
  return messages;
}

export async function modelsCommand(ctx: CommandContext<Context>) {
  try {
    const catalog = await getRuntimeModelCatalog();
    const providers = catalog.providers;

    if (!providers || providers.length === 0) {
      await ctx.reply(t("legacy.models.empty"));
      return;
    }

    const messages = splitCatalogMessages(providers);

    for (const message of messages) {
      await ctx.reply(message);
    }
  } catch (error) {
    logger.error("[ModelsCommand] Error listing models:", error);
    await ctx.reply(t("legacy.models.error"));
  }
}
