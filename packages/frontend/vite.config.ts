import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * O navegador precisa de duas coisas do Supabase: a URL e a chave anon. Elas
 * vêm das MESMAS variáveis que o servidor usa (SUPABASE_URL e
 * SUPABASE_ANON_KEY), para quem implanta não cadastrar a URL duas vezes com
 * nomes diferentes. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY continuam
 * valendo e têm prioridade, para quem já as tem configuradas.
 *
 * Só esses dois valores entram no bundle, um a um, pelo `define`. Nada de
 * envPrefix amplo: SUPABASE_SERVICE_ROLE_KEY mora nas mesmas variáveis e não
 * pode chegar ao navegador.
 *
 * Os .env locais são lidos da raiz do repositório e da pasta do frontend;
 * na Vercel, das variáveis do projeto.
 */
export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, path.resolve(__dirname, "../.."), ""),
    ...loadEnv(mode, __dirname, ""),
  };
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";

  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey),
    },
    server: {
      host: "::",
      port: 5173,
      hmr: {
        overlay: false,
      },
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["@tanstack/react-query"],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react':  ['react', 'react-dom', 'react-router-dom'],
            'vendor-ui':     ['lucide-react'],
            'vendor-charts': ['recharts'],
            'vendor-query':  ['@tanstack/react-query'],
            'vendor-stripe': ['@stripe/stripe-js', '@stripe/react-stripe-js'],
          },
        },
      },
    },
  };
});
