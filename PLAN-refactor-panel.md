# Plano de Refactoring: Panel UI - Untitled UI Best Practices

## Contexto

O painel React (`panel/src/`) segue a maioria das práticas do Untitled UI, mas tem 3 problemas:
1. `App.jsx` e `main.jsx` usam `.jsx` em vez de `.tsx` (TypeScript)
2. `App.jsx` é um arquivo monolítico de ~1870 linhas que deveria ser separado em componentes menores
3. `App.jsx:47` define `classNames()` duplicada quando já existe `cx()` em `@/utils/cx`

## Regras gerais

- **Não alterar nenhuma lógica** — apenas reorganizar e tipar
- Arquivos novos devem usar **kebab-case** e extensão `.tsx` / `.ts`
- Usar `cx()` de `@/utils/cx` em todos os lugares (nunca `classNames`)
- Manter todos os imports usando `@/` alias
- Manter todos os tokens semânticos de cor (text-primary, bg-secondary, etc.)
- Não adicionar dependências novas

---

## Etapa 1: Substituir `classNames` por `cx`

**Arquivo:** `panel/src/App.jsx`

1. Remover a função `classNames` (linha 47-49):
```js
// REMOVER:
function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}
```

2. Adicionar `cx` ao import existente (o import de `cx` ainda não existe no App.jsx):
```js
import { cx } from '@/utils/cx';
```

3. Substituir todas as ocorrências de `classNames(` por `cx(` no arquivo. São ~15 ocorrências.

**Validação:** `npm run panel:build` deve compilar sem erros.

---

## Etapa 2: Extrair types e constantes para arquivos dedicados

Criar o arquivo `panel/src/types.ts` com as interfaces de tipo:

```ts
// panel/src/types.ts

export interface TextFieldConfig {
  key: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  placeholder: string;
  description: string;
  help?: {
    title: string;
    summary: string;
    steps: string[];
  };
  password?: boolean;
  folderPicker?: boolean;
}

export interface ToggleConfig {
  key: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  description: string;
}

export interface SetupSection {
  key: string;
  title: string;
  description: string;
  textKeys: string[];
  toggleKeys: string[];
}

export interface ValidationResult {
  level: 'success' | 'error' | 'warning' | 'neutral';
  message: string;
}

export interface LogEntry {
  id?: string;
  ts?: string;
  level?: string;
  source?: string;
  message?: string;
}

export interface ToastState {
  open: boolean;
  message: string;
  color: 'success' | 'warning' | 'danger' | 'neutral';
}

export interface RuntimeSettings {
  streamOutput: boolean;
  logPrompt: boolean;
}

export interface LogSourceMeta {
  label: string;
  icon: React.FC<{ className?: string }>;
  side: 'incoming' | 'outgoing';
  avatarUrl?: string;
  avatarInitials: string;
  directClaude: boolean;
}

export interface LogLevelMeta {
  label: string;
  icon: React.FC<{ className?: string }>;
}
```

Criar o arquivo `panel/src/constants.ts`:

Mover para cá (do `App.jsx`) todas as constantes que estão fora do componente `App`:
- `TEXT_FIELD_CONFIG`
- `TOGGLE_CONFIG`
- `TEXT_FIELD_KEYS`, `TOGGLE_KEYS`, `TEXT_FIELD_BY_KEY`, `TOGGLE_BY_KEY`
- `SETUP_SECTIONS`
- `LABEL_BY_KEY`
- `NAV_TAB_KEYS`
- `CLAUDE_CHAT_MAX_CHARS`, `CLAUDE_CODE_AVATAR_URL`
- `LOG_LEVEL_META`, `LOG_SOURCE_META`
- `TOAST_TONE_CLASSES`, `PROCESS_ACTION_BUTTON_CLASS`
- `FEED_TIMESTAMP_FORMATTER`

Os imports de ícones necessários devem acompanhar (`Key01`, `Database01`, `ShieldTick`, etc.).

Tipar as constantes usando as interfaces de `types.ts`.

---

## Etapa 3: Extrair funções utilitárias para `panel/src/utils/`

Criar `panel/src/utils/config-helpers.ts`:
```ts
// Mover estas funções de App.jsx:
export function envToBool(value: unknown, fallback?: boolean): boolean
export function boolToEnv(value: boolean): string
export function normalizeText(value: unknown): string
export function normalizeDatabaseId(value: string): string
export function buildInitialConfig(): Record<string, string | boolean>
export function parseConfigPayload(values: Record<string, unknown>): Record<string, string | boolean>
export function parseRuntimeSettingsPayload(payload: Record<string, unknown>): RuntimeSettings
export function isSameConfigValue(key: string, a: unknown, b: unknown): boolean
export function isSetupConfigurationComplete(values: Record<string, unknown>): boolean
export function validateFieldValue(key: string, rawValue: unknown): ValidationResult
export function buildNotionDatabaseUrl(databaseId: string): string
export function resolveApiBaseUrl(): string
```

Criar `panel/src/utils/log-helpers.ts`:
```ts
// Mover estas funções de App.jsx:
export function normalizeLogLevel(level: unknown): string
export function logLevelMeta(level: unknown): LogLevelMeta
export function normalizeSourceKey(source: unknown): string
export function isClaudeTaskContractMessage(message: unknown): boolean
export function resolveLogSourceKey(source: unknown, message: unknown): string
export function logSourceMeta(entry: LogEntry | string): LogSourceMeta
export function logToneClasses(level: string, side?: string, directClaude?: boolean): string
export function formatIntervalLabel(ms: number): string
export function formatReasonToken(reasonToken: string): string
export function formatReconciliationReason(reasonRaw: string): string
export function formatLiveFeedMessage(entry: LogEntry): string
export function formatFeedTimestamp(value: unknown): string
export function helpTooltipContent(helperText: string | undefined, help: TextFieldConfig['help']): string | null
```

---

## Etapa 4: Extrair componentes pequenos/reutilizáveis

Criar os seguintes arquivos em `panel/src/components/`:

### `panel/src/components/icon.tsx`
Mover o componente `Icon` (App.jsx linhas 51-57):
```tsx
import type { FC } from 'react';

export function Icon({ icon: IconComponent, className = 'size-4' }: {
  icon?: FC<{ className?: string; 'aria-hidden'?: string }>;
  className?: string;
}) {
  if (!IconComponent) return null;
  return <IconComponent aria-hidden="true" className={className} />;
}
```

### `panel/src/components/connection-dot.tsx`
Mover `ConnectionDot` (linhas 720-727).

### `panel/src/components/status-badge.tsx`
Mover `StatusBadge` (linhas 729-739). Importar `ConnectionDot`, `Icon`, `Badge`.

### `panel/src/components/source-avatar.tsx`
Mover `SourceAvatar` (linhas 412-440). Importar `Icon`.

### `panel/src/components/toast-notification.tsx`
Extrair o bloco JSX do toast (linhas 1845-1864) para um componente:
```tsx
export function ToastNotification({ toast }: { toast: ToastState }) { ... }
```

---

## Etapa 5: Extrair seções de página

### `panel/src/components/panel-header.tsx`
Extrair o `<header>` (linhas 1196-1245).
Props: `activeTab`, `setActiveTab`, `isDark`, `onThemeToggle`.

### `panel/src/components/setup-tab.tsx`
Extrair o `<Tabs.Panel id="setup">` inteiro (linhas 1257-1459).
Props: tudo que o setup precisa — `config`, `setConfig`, `savedConfig`, `validationMap`, `revealedFields`, `toggleFieldVisibility`, `notionDatabaseUrl`, `busy`, `pickClaudeWorkdir`, `saveDisabled`, `hasBlockingErrors`, `allFieldsValidated`, `changedKeys`, `onSaveClick`.

### `panel/src/components/operations-tab.tsx`
Extrair o `<Tabs.Panel id="operations">` inteiro (linhas 1461-1725).
Props: `apiRunning`, `tunnelRunning`, `apiHealthStatus`, `busy`, `runAction`, `webhookUrl`, `copyWebhook`, `logs`, `logFeedRef`, `chatDraft`, `setChatDraft`, `sendClaudeChatMessage`, `onChatDraftKeyDown`, `copyLiveFeedMessage`, `setRuntimeSettingsModalOpen`.

### `panel/src/components/save-confirm-modal.tsx`
Extrair o modal de confirmação de save (linhas 1729-1780).
Props: `saveConfirm`, `setSaveConfirm`, `busy`, `persistConfig`.

### `panel/src/components/runtime-settings-modal.tsx`
Extrair o modal de runtime settings (linhas 1782-1843).
Props: `runtimeSettingsModalOpen`, `setRuntimeSettingsModalOpen`, `apiRunning`, `runtimeSettings`, `busy`, `updateRuntimeSetting`.

---

## Etapa 6: Renomear App.jsx → app.tsx e main.jsx → main.tsx

1. Renomear `panel/src/App.jsx` → `panel/src/app.tsx`
2. O conteúdo de `app.tsx` ficará enxuto: apenas o componente `App` com os hooks e estado, importando todos os subcomponentes e utils
3. Renomear `panel/src/main.jsx` → `panel/src/main.tsx`
4. Atualizar o import dentro de `main.tsx`:
```tsx
import { App } from './app';
```
5. Atualizar `panel/vite.config.mjs` se necessário (Vite resolve `.tsx` automaticamente, mas conferir se `index.html` referencia `main.jsx` diretamente).

---

## Etapa 7: Validação final

1. Rodar `npm run panel:build` — deve compilar sem erros
2. Rodar `npm run panel:dev` — deve abrir o painel normalmente
3. Conferir que:
   - O tema light/dark funciona
   - As abas Setup e Operations renderizam
   - Os modais abrem/fecham
   - O toast aparece
   - O live feed renderiza logs
4. Se o projeto tiver testes: `npm test`

---

## Estrutura final esperada

```
panel/src/
├── app.tsx                           # Componente App (apenas estado + layout)
├── main.tsx                          # Entry point com PanelRoot
├── types.ts                          # Interfaces TypeScript
├── constants.ts                      # Constantes, configs, metadata
├── theme.css                         # (inalterado)
├── components/
│   ├── base/                         # (inalterado — já está correto)
│   │   ├── buttons/button.tsx
│   │   ├── input/...
│   │   ├── toggle/toggle.tsx
│   │   ├── badges/badges.tsx
│   │   └── tooltip/tooltip.tsx
│   ├── application/                  # (inalterado)
│   │   ├── tabs/tabs.tsx
│   │   └── modals/modal.tsx
│   ├── foundations/                  # (inalterado)
│   ├── icon.tsx                      # NEW — Icon wrapper
│   ├── connection-dot.tsx            # NEW
│   ├── status-badge.tsx              # NEW
│   ├── source-avatar.tsx             # NEW
│   ├── toast-notification.tsx        # NEW
│   ├── panel-header.tsx              # NEW
│   ├── setup-tab.tsx                 # NEW — maior componente extraído
│   ├── operations-tab.tsx            # NEW — segundo maior
│   ├── save-confirm-modal.tsx        # NEW
│   └── runtime-settings-modal.tsx    # NEW
├── utils/
│   ├── cx.ts                        # (inalterado)
│   ├── is-react-component.ts        # (inalterado)
│   ├── config-helpers.ts            # NEW — helpers de config/.env
│   └── log-helpers.ts               # NEW — helpers de log/feed
└── styles/
    ├── globals.css                   # (inalterado)
    ├── theme.css                     # (inalterado)
    └── typography.css                # (inalterado)
```

## Ordem de execução recomendada

Seguir exatamente esta ordem para evitar quebras intermediárias:

1. **Etapa 1** — Trocar `classNames` por `cx` (menor risco, valida build)
2. **Etapa 2** — Criar `types.ts` e `constants.ts`
3. **Etapa 3** — Criar `utils/config-helpers.ts` e `utils/log-helpers.ts`
4. **Etapa 4** — Extrair componentes pequenos (Icon, ConnectionDot, StatusBadge, SourceAvatar, ToastNotification)
5. **Etapa 5** — Extrair seções de página (PanelHeader, SetupTab, OperationsTab, modais)
6. **Etapa 6** — Renomear `.jsx` → `.tsx` e ajustar imports
7. **Etapa 7** — Validar build e funcionalidade

Cada etapa deve terminar com `npm run panel:build` passando sem erros.
