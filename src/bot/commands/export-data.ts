import { Context } from "grammy";
import { showExportDataMenu } from "../handlers/export-data.js";

export async function exportDataCommand(ctx: Context): Promise<void> {
  await showExportDataMenu(ctx);
}
