import { Bot } from "grammy";

async function test() {
  console.log("Starting Telegram API test...");
  const token = "8829256119:AAG8B6OK1i1Pp9Pa1d4gnqQ1IAAOCnGQacU";
  const bot = new Bot(token);
  try {
    console.log("Calling getMe()...");
    const me = await bot.api.getMe();
    console.log("Me:", me.username);

    console.log("Calling getWebhookInfo()...");
    const webhookInfo = await bot.api.getWebhookInfo();
    console.log("WebhookInfo:", webhookInfo);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
