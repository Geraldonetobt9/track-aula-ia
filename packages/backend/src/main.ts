import { createApp } from './bootstrap';

/**
 * Servidor local. Em producao quem serve e a funcao serverless em /api,
 * que monta a mesma aplicacao via createApp().
 */
async function main() {
  const app = await createApp();
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend rodando em http://localhost:${port}`);
}

main();
