# Aparência (Tema claro/escuro)

> **Modulo:** N/A (puramente frontend) | **Pagina:** `packages/frontend/src/pages/Settings.tsx` (aba Aparência) + `packages/frontend/src/components/ThemeToggle.tsx` (atalho global no Sidebar/Header)
> **Ultima atualizacao:** 2026-05-02
> **Status:** Aprovado

---

## 1. Proposito

Permite ao usuário escolher entre tema **claro**, **escuro** ou **acompanhar o sistema operacional**. A preferência é persistida em `localStorage` (chave `sentinel-theme`) e aplicada antes da hidratação do React, sem flash. Quando o usuário acessa pela primeira vez (sem valor salvo), o app inicia em **dark** — identidade visual padrão do produto. Beneficia qualquer usuário autenticado e também as páginas de auth (Login, Register, Forgot, Reset).

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

- **Sidebar (desktop)** — ícone sol/lua acima do email do usuário e botão Sair. Sempre visível.
- **Header mobile** — ícone sol/lua à direita do logo, ao lado do botão de menu.
- **Settings → Aparência** — aba dedicada com 3 cards (Sistema / Claro / Escuro) com descrição.
- Todas as instâncias do toggle compartilham o mesmo estado via `useTheme()` do `next-themes` — selecionar em qualquer lugar reflete instantaneamente nas outras.

### 2.2 Fluxo de UI

1. Usuário entra pela primeira vez → tema = `dark` (padrão do produto). Pode mudar para `light` ou `system` no toggle.
2. Clica no ícone sol/lua → abre Dropdown com Sistema / Claro / Escuro. Item ativo marcado com `●`.
3. Seleciona uma opção → `<html>` ganha/perde a classe `dark` instantaneamente, sem transição (`disableTransitionOnChange`). `localStorage.sentinel-theme` é atualizado.
4. Em outro device (ou modo anônimo), preferência é independente — multi-device sync **não** está no escopo do v1.
5. Voltando para "Sistema" volta a seguir mudanças do OS dinamicamente.

### 2.3 Permissoes

Sem restrição. Qualquer visitante (logado ou não) pode trocar o tema.

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Default Dark | Primeiro acesso ao app, sem `localStorage.sentinel-theme` | Tema = `dark`. |
| RN-02 | Persistência local | Usuário escolhe Dark/Light explicitamente | `localStorage.sentinel-theme` recebe `'dark'`/`'light'`. Persiste entre sessões nesse browser. |
| RN-03 | Sistema dinâmico | Tema = `system` e usuário muda OS para dark/light | App reflete a mudança em tempo real (event listener do `matchMedia`). |
| RN-04 | Sem FOUC | Boot da SPA com tema explícito = light | `<html class="light">` aplicado antes do React montar. Nenhum flash escuro perceptível. |
| RN-05 | Sincronização entre toggles | Usuário troca tema via Sidebar | ThemeToggle do Settings reflete imediatamente sem reload. |
| RN-06 | Sem propagação a outros devices | Usuário troca tema no notebook | Preferência **não** é replicada para celular. (Decisão de design v1) |

## 4. Modelo de Dados

Não há tabela. Estado vive 100% em `localStorage` (chave `sentinel-theme`, valores `light` / `dark` / `system`).

## 5. API / Backend

Não há endpoint. Mudança de tema é puramente client-side.

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

- `src/App.tsx` — wrap raiz com `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="sentinel-theme" />` do `next-themes`.
- `src/index.css` — tokens CSS no `:root` (light) e `.dark` (dark). Inclui `--accent-readable` (lime escuro p/ texto/link em fundo claro), `--glass-overlay` e `--glass-border` (overlays para utilitários `.glass-*`). Status colors (`--success`, `--destructive`, `--warning`, `--info`) ganharam tonalidades reais (verde/vermelho/amarelo/azul) — antes eram todos lime/cinza.
- `src/components/ThemeToggle.tsx` — Dropdown com Sun/Moon/Monitor. Reusado em Sidebar e DashboardLayout (mobile header).
- `src/components/settings/AppearanceCard.tsx` — 3 cards selecionáveis para a aba Aparência.
- `src/components/Sidebar.tsx` — adicionou `<ThemeToggle />` na seção inferior (acima do email).
- `src/components/DashboardLayout.tsx` — adicionou `<ThemeToggle />` no header mobile.
- `src/pages/Settings.tsx` — nova `TabsTrigger value="appearance"` + `<AppearanceCard />`.

### 6.2 Hooks

- **`useTheme()`** do `next-themes` — retorna `{ theme, setTheme, resolvedTheme }`. `theme` pode ser `'system'`; `resolvedTheme` é sempre `'light'` ou `'dark'`.
- **`useChartColors()`** (`src/hooks/useChartColors.ts`) — lê tokens via `getComputedStyle(document.documentElement)` e retorna paleta resolvida + array `series` para charts multi-cor. Re-renderiza quando `resolvedTheme` muda.

### 6.3 Gerenciamento de Estado

Sem Context custom — `next-themes` provê o seu próprio. Não interage com TanStack Query, AuthContext ou WorkspaceContext.

## 7. Pontos de Integracao

- **Sonner toaster** (`components/ui/sonner.tsx`) já lê `useTheme()` e ajusta visual.
- **Componentes shadcn/ui** (button, badge, table, tabs, separator, dropdown, select, toggle, tooltip, sonner, form, alert, toast) foram normalizados para tokens semânticos — qualquer feature futura herda automático.
- **Recharts** — todos os charts usam `useChartColors()` para `fill`/`stroke`.

## 8. Edge Cases e Tratamento de Erros

- **localStorage indisponível** (modo privado restritivo, browser antigo) → `next-themes` cai para `defaultTheme` (system) sem erro.
- **Usuário troca o OS enquanto app está aberto** com tema = `system` → `next-themes` escuta `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)` e re-aplica.
- **SSR / pré-render** → não aplicável (Vite SPA).
- **Glass effects em fundo claro** → `.glass-card` e `.glass-sidebar` viram superfícies sólidas no light (sem `backdrop-filter`); `.glass-header` mantém glass adaptado para `hsl(var(--background) / 0.7)`.

## 9. Checklist de Testes

- [ ] Boot com tema = system, OS dark → app renderiza dark sem flash
- [ ] Boot com tema = system, OS light → app renderiza light sem flash
- [ ] Boot com tema = light após reload → app renderiza light sem flash
- [ ] Trocar tema via Sidebar reflete em Settings sem refresh
- [ ] Trocar tema via Settings reflete no Sidebar sem refresh
- [ ] Mudar OS para dark com tema = system: app vira dark em tempo real
- [ ] Login, Register, Forgot, Reset funcionam em ambos os temas
- [ ] Dashboard charts re-renderizam com paleta correta ao alternar
- [ ] Modais (PlanLimitModal, ExpiredAccessModal, dialogs) com scrim escuro nos dois temas
- [ ] Sonner toasts (success/error/info) visíveis nos dois temas
- [ ] WCAG AA contraste em todos os textos no light (axe DevTools)
- [ ] `npm run lint` (inclui `check-theme.sh`) passa sem erros
- [ ] `npm run build` finaliza sem erro

## 10. Questoes Abertas / TODOs

- **Multi-device sync** — fora do v1. Se vier demanda, persistir em `profiles.theme_preference` + chamada na troca, com `localStorage` como cache local autoritativo até bater com remoto no login.
- **SalesGlobe** (Three.js / globe.gl) — usa cores hardcoded em material/textures. Conferir se a paleta resolvida é injetada via prop (ver Phase 6 do PR de implementação).
- **Páginas Landing.tsx, /admin/\*\*** — fora do escopo formal v1, mas o sweep tocou /admin pragmaticamente. Landing mantém identidade visual própria (não acompanha tema do usuário).
