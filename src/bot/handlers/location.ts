import type { Context } from "grammy";
import { extractMessageMetadata, type ResolvedDeferredItem, formatMetadataLine } from "../../media/batch-types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { updateLiveLocation, deleteLiveLocation, isLiveLocationActive } from "../live-location.js";
import { fetchLocationContext, formatLocationContextText } from "../location-context.js";

export interface LocationHandlerDeps extends ProcessPromptDeps {
  processPrompt?: (
    ctx: Context,
    text: string,
    deps: ProcessPromptDeps,
  ) => Promise<boolean>;
  enqueueCorrelatedItem?: (item: ResolvedDeferredItem) => boolean;
  acquireProcessingHold?: () => (() => void) | null;
}

export async function handleLocationMessage(ctx: Context, deps: LocationHandlerDeps): Promise<void> {
  const loc = ctx.message?.location;
  if (!loc) return;

  const userId = ctx.from?.id;
  if (!userId) return;

  const lat = loc.latitude.toFixed(6);
  const lon = loc.longitude.toFixed(6);
  const livePeriod = ctx.message?.location?.live_period;

  if (livePeriod && livePeriod > 0) {
    // Live location started — fetch timezone and store it
    const locationCtx = await fetchLocationContext(loc.latitude, loc.longitude);
    updateLiveLocation(
      userId,
      loc.latitude,
      loc.longitude,
      livePeriod,
      locationCtx.timezone,
      locationCtx.utcOffset,
    );

    logger.debug(`[Location] Live location started for user ${userId}: ${lat}, ${lon}, tz=${locationCtx.timezone}`);
    await ctx.reply(t("location.live_started", { lat, lon }), {
      reply_parameters: { message_id: ctx.message!.message_id },
      parse_mode: undefined,
    });
    return;
  }

  if (isLiveLocationActive(userId)) {
    deleteLiveLocation(userId);
    logger.debug(`[Location] Live location stopped for user ${userId}`);
    await ctx.reply(t("location.live_stopped"), {
      reply_parameters: { message_id: ctx.message!.message_id },
      parse_mode: undefined,
    });
    return;
  }

  // One-time location share — fetch context and process as prompt
  const metadata = extractMessageMetadata(ctx);
  const metadataPrefix = formatMetadataLine(metadata, "");

  const locationCtx = await fetchLocationContext(loc.latitude, loc.longitude);
  const contextText = formatLocationContextText(locationCtx);

  const locationText = [
    metadataPrefix,
    `[Location: lat=${lat}, lon=${lon}]`,
    contextText,
  ].filter(Boolean).join("\n");

  const processPrompt = deps.processPrompt ?? processUserPrompt;
  const enqueueCorrelatedItem = deps.enqueueCorrelatedItem;
  const acquireProcessingHold = deps.acquireProcessingHold;

  const releaseHold = acquireProcessingHold?.() ?? null;
  if (releaseHold) {
    releaseHold();
  }

  logger.debug(`[Location] One-time location from user ${userId}: ${lat}, ${lon}, tz=${locationCtx.timezone}`);

  if (enqueueCorrelatedItem) {
    const isDeferred = enqueueCorrelatedItem({
      correlationId: `location:${ctx.message?.message_id ?? Date.now()}`,
      kind: "text",
      directText: locationText,
      previewText: `Location: ${lat}, ${lon} | ${locationCtx.weather?.description ?? "?"} ${locationCtx.weather?.temperature ?? "?"}°C`,
      contextText: locationText,
      ctx,
      metadata,
    });

    if (isDeferred) {
      return;
    }
  }

  await processPrompt(ctx, locationText, deps);
}

export async function handleEditedLocation(ctx: Context): Promise<void> {
  const msg = ctx.editedMessage;
  if (!msg?.location) return;

  const userId = msg.from?.id;
  if (!userId) return;

  const loc = msg.location;
  const livePeriod = loc.live_period;
  const lat = loc.latitude.toFixed(6);
  const lon = loc.longitude.toFixed(6);

  if (livePeriod && livePeriod > 0) {
    updateLiveLocation(userId, loc.latitude, loc.longitude, livePeriod);
    logger.debug(`[Location] Live location updated for user ${userId}: ${lat}, ${lon}`);
  } else if (isLiveLocationActive(userId)) {
    deleteLiveLocation(userId);
    logger.debug(`[Location] Live location stopped (via edit) for user ${userId}`);
  }
}
