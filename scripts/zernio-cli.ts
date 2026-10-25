/**
 * CLI de Zernio — la prueba de que credenciales y tipos están bien ANTES de
 * construir nada encima.
 *
 *   npm run zernio -- accounts
 *   npm run zernio -- conversations [--channel whatsapp]
 *
 * Contra la API real requiere ZERNIO_API_KEY. Con ZERNIO_MOCK=1 corre contra
 * el proveedor mock local.
 */
import "./load-env";
import {
  iterateProviderConversations,
  listProviderAccounts,
  providerName,
  usingMockProvider,
} from "../src/lib/zernio";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!usingMockProvider() && !process.env.ZERNIO_API_KEY) {
    console.error("Falta ZERNIO_API_KEY (o usá ZERNIO_MOCK=1 para el mock local).");
    process.exit(1);
  }

  if (command === "accounts") {
    const result = await listProviderAccounts();
    if (!result.success) {
      console.error("Error listando cuentas:", result.error);
      process.exit(1);
    }
    console.log(`Proveedor: ${providerName()}`);
    console.log(`Cuentas (${result.data.length}):`);
    for (const account of result.data) {
      console.log(
        `  ${account.channel.padEnd(9)} ${account.id.padEnd(20)} ${account.name ?? "-"} [${account.status}]`,
      );
    }
    return;
  }

  if (command === "conversations") {
    const channelIndex = args.indexOf("--channel");
    const channel = channelIndex >= 0 ? args[channelIndex + 1] : undefined;
    if (channel && !["whatsapp", "instagram", "facebook"].includes(channel)) {
      console.error("--channel debe ser whatsapp | instagram | facebook");
      process.exit(1);
    }
    let total = 0;
    console.log(`Proveedor: ${providerName()}`);
    for await (const conversation of iterateProviderConversations({
      channel: channel as "whatsapp" | "instagram" | "facebook" | undefined,
    })) {
      total += 1;
      const who = conversation.participant.handle ?? conversation.participant.name ?? conversation.participant.id;
      console.log(
        `  ${conversation.channel.padEnd(9)} ${conversation.id.padEnd(16)} ${String(who).padEnd(24)} no leídos: ${conversation.unread_count}`,
      );
    }
    console.log(`Total: ${total} conversaciones.`);
    return;
  }

  console.error("Uso: npm run zernio -- accounts | conversations [--channel whatsapp]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
