import type { Context } from "grammy";
import { config } from "../../config.js";
import { getLocalizedBotCommands } from "../commands/definitions.js";

type CommandSyncApi = Pick<Context["api"], "setMyCommands" | "setChatMenuButton">;
type TelegramChatType = NonNullable<Context["chat"]>["type"];

export async function syncAuthorizedChatCommands(
  api: CommandSyncApi,
  chatId: number,
  chatType: TelegramChatType,
  isAdmin?: boolean,
): Promise<void> {
  const isAdminUser = isAdmin ?? chatId === config.telegram.adminUserId;
  const commands = getLocalizedBotCommands({ isAdmin: isAdminUser });

  const tasks: Promise<unknown>[] = [
    api.setMyCommands(commands, {
      scope: {
        type: "chat",
        chat_id: chatId,
      },
    }),
  ];

  if (chatType === "private") {
    tasks.push(
      api.setChatMenuButton({
        chat_id: chatId,
        menu_button: { type: "commands" },
      }),
    );
  }

  await Promise.all(tasks);
}

export async function syncUnauthorizedPrivateChatCommands(
  api: CommandSyncApi,
  chatId: number,
): Promise<void> {
  const commands = getLocalizedBotCommands({ isAdmin: false });

  await Promise.all([
    api.setMyCommands(commands, {
      scope: {
        type: "chat",
        chat_id: chatId,
      },
    }),
    api.setChatMenuButton({
      chat_id: chatId,
      menu_button: { type: "commands" },
    }),
  ]);
}

export async function resetDefaultMenuButton(api: CommandSyncApi): Promise<void> {
  await api.setChatMenuButton({
    menu_button: { type: "default" },
  });
}
