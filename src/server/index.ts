import 'dotenv/config';
import { createApp, seedInitialDemoInvoicesIfEmpty } from './app.js';

const PORT = Number(process.env.PORT || 3001);

async function startServer() {
  await seedInitialDemoInvoicesIfEmpty();
  const app = createApp();

  app.listen(PORT, () => {
    console.log(
      `[STEWARD] Accounts-Payable Security & NEAR Intents Engine listening on http://localhost:${PORT}`
    );
  });
}

startServer().catch((err) => {
  console.error('[STEWARD] Fatal startup error:', err);
  process.exit(1);
});
