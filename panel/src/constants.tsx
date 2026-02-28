// panel/src/constants.tsx

import {
  Activity,
  AlertCircle,
  Asterisk02,
  Beaker01,
  CheckCircle,
  Columns03,
  CpuChip02,
  File03,
  Folder,
  GitCommit,
  InfoCircle,
  LockUnlocked01,
  MessageChatCircle,
  PlayCircle,
  Server01,
  Settings01,
  TerminalBrowser,
  User01,
  Users01,
  XCircle
} from '@untitledui/icons';
import type { TextFieldConfig, ToggleConfig, SetupSection, LogLevelMeta, LogSourceMeta } from './types';

export const CLAUDE_MODELS = [
  { value: '', label: 'Automatic (use task model)', description: 'Uses the model specified in each task' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most capable, best for complex tasks' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', description: 'Balanced performance and speed' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fast and cost-effective' }
] as const;

export const CLAUDE_TASK_MODELS = CLAUDE_MODELS.filter((m) => m.value !== '');

export const CLAUDE_DEFAULT_TASK_MODEL = 'claude-sonnet-4-5-20250929';

export const TEXT_FIELD_CONFIG: TextFieldConfig[] = [
  {
    key: 'CLAUDE_CODE_OAUTH_TOKEN',
    label: 'Claude OAuth Token',
    icon: User01,
    placeholder: 'sk-ant-...',
    description: 'Used by the automation runner to execute tasks non-interactively. Not required for panel features (Review, Generate Stories, Chat) — those use your local Claude CLI login.',
    help: {
      title: 'How to get Claude OAuth Token',
      summary: 'Generate a token from Claude CLI on your machine.',
      steps: [
        <>Run <code className="cursor-pointer select-all rounded bg-quaternary px-1.5 py-0.5 font-mono text-xs text-secondary" onClick={() => navigator.clipboard.writeText('claude setup-token')} title="Click to copy">claude setup-token</code> in your terminal.</>,
        'Copy the generated token.',
        'Paste the token in this field.'
      ]
    },
    password: true
  },
  {
    key: 'CLAUDE_WORKDIR',
    label: 'Claude Working Directory',
    icon: Folder,
    placeholder: '/Users/you/your-project',
    description: 'The target project folder where Claude will execute tasks (NOT the Product Manager folder).',
    help: {
      title: 'How to choose Claude Working Directory',
      summary: 'Select the project where your tasks will be executed.',
      steps: [
        'Choose the folder of your target project (e.g., your React/Next.js app).',
        'Create a "Board/" folder inside this project directory.',
        'Tasks in Board/ will be executed in this project context.',
        'Example: If your app is at /Users/you/my-app, select /Users/you/my-app and create /Users/you/my-app/Board/'
      ]
    },
    folderPicker: true
  },
  {
    key: 'CLAUDE_MODEL_OVERRIDE',
    label: 'Claude Model Override',
    icon: CpuChip02,
    placeholder: '',
    description: 'Override the default Claude model for all tasks.',
    help: {
      title: 'Claude Model Selection',
      summary: 'Choose which Claude model to use for task execution.',
      steps: [
        'Use Automatic to use the model specified in each task.',
        'Or select a model to override all task models.',
        'Opus 4.6 is most capable but slower, Haiku 4.5 is fastest.'
      ]
    },
    selectOptions: CLAUDE_MODELS
  }
];

export const TOGGLE_CONFIG: ToggleConfig[] = [
  {
    key: 'CLAUDE_FULL_ACCESS',
    label: 'Allow Claude Full Access',
    icon: LockUnlocked01,
    description: 'Lets Claude run task commands without extra permission prompts.',
    warning: 'This grants Claude unrestricted access to execute commands, modify files, and install packages in the working directory without asking for confirmation. Only enable this if you trust the tasks in your queue and understand the risks.'
  },
  {
    key: 'CLAUDE_STREAM_OUTPUT',
    label: 'Show Claude Live Output',
    icon: Activity,
    description: 'Streams Claude execution logs live in terminal and panel feed.'
  },
  {
    key: 'CLAUDE_LOG_PROMPT',
    label: 'Log Prompt Sent to Claude',
    icon: File03,
    description: 'Prints the full generated prompt before each task execution.'
  },
  {
    key: 'OPUS_REVIEW_ENABLED',
    label: 'Opus Review After Completion',
    icon: CheckCircle,
    description: 'Tasks completed by non-Opus models are reviewed by Opus before moving to Done.'
  },
  {
    key: 'EPIC_REVIEW_ENABLED',
    label: 'Epic Review Before Closing',
    icon: CheckCircle,
    description: 'When all sub-tasks are done, Opus runs tests and reviews the entire Epic before moving it to Done.'
  },
  {
    key: 'FORCE_TEST_CREATION',
    label: 'Force Test Creation',
    icon: Beaker01,
    description: 'Claude must create automated tests for each task when applicable.'
  },
  {
    key: 'FORCE_TEST_RUN',
    label: 'Force Test Run',
    icon: PlayCircle,
    description: 'Claude must run all tests and ensure they pass before finishing a task.'
  },
  {
    key: 'FORCE_COMMIT',
    label: 'Force Commit',
    icon: GitCommit,
    description: 'Claude must create a commit before moving the task to Done.'
  },
  {
    key: 'AUTO_VERSION_ENABLED',
    label: 'Automatic Versioning',
    icon: GitCommit,
    description: 'Claude follows SemVer and Conventional Commits, bumping package.json version before each commit.'
  },
  {
    key: 'ENABLE_MULTI_AGENTS',
    label: 'Enable Multi-Agent Execution',
    icon: Users01,
    description: 'When enabled, Claude will use multiple agents in parallel for complex tasks to improve speed and quality.'
  }
];

export const TEXT_FIELD_KEYS = TEXT_FIELD_CONFIG.map((field) => field.key);
export const TOGGLE_KEYS = TOGGLE_CONFIG.map((field) => field.key);
export const TEXT_FIELD_BY_KEY = Object.fromEntries(TEXT_FIELD_CONFIG.map((field) => [field.key, field]));
export const TOGGLE_BY_KEY = Object.fromEntries(TOGGLE_CONFIG.map((field) => [field.key, field]));

export const SETUP_SECTIONS: SetupSection[] = [
  {
    key: 'claude',
    title: 'Claude Runner',
    description: 'Authentication, command, and workspace configuration.',
    textKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_WORKDIR', 'CLAUDE_MODEL_OVERRIDE'],
    toggleKeys: ['CLAUDE_FULL_ACCESS']
  },
  {
    key: 'execution',
    title: 'Execution',
    description: 'Controls how Claude executes tasks, including multi-agent and review options.',
    textKeys: [],
    toggleKeys: ['ENABLE_MULTI_AGENTS', 'OPUS_REVIEW_ENABLED', 'EPIC_REVIEW_ENABLED']
  },
  {
    key: 'quality',
    title: 'Quality Gates',
    description: 'Enforce test creation, test runs, commits, and versioning before tasks are marked as done.',
    textKeys: [],
    toggleKeys: ['FORCE_TEST_CREATION', 'FORCE_TEST_RUN', 'FORCE_COMMIT', 'AUTO_VERSION_ENABLED']
  }
];

export const LABEL_BY_KEY = Object.fromEntries([...TEXT_FIELD_CONFIG, ...TOGGLE_CONFIG].map((field) => [field.key, field.label]));

export const NAV_TAB_KEYS = {
  setup: 'setup',
  feed: 'feed',
  board: 'board',
  git: 'git'
} as const;

export const SIDEBAR_NAV_ITEMS = [
  { key: NAV_TAB_KEYS.setup, label: 'Setup', icon: Settings01 },
  { key: NAV_TAB_KEYS.feed, label: 'Feed', icon: TerminalBrowser },
  { key: NAV_TAB_KEYS.board, label: 'Board', icon: Columns03 },
  { key: NAV_TAB_KEYS.git, label: 'Git', icon: GitCommit }
] as const;

export const CLAUDE_CHAT_MAX_CHARS = 12000;
export const LOG_LEVEL_META: Record<string, LogLevelMeta> = {
  info: {
    label: 'Info',
    icon: InfoCircle
  },
  success: {
    label: 'Success',
    icon: CheckCircle
  },
  warn: {
    label: 'Alert',
    icon: AlertCircle
  },
  error: {
    label: 'Error',
    icon: XCircle
  }
};

export const LOG_SOURCE_META: Record<string, LogSourceMeta> = {
  panel: {
    label: 'User',
    icon: User01,
    side: 'outgoing',
    avatarInitials: 'US',
    directClaude: false
  },
  claude: {
    label: 'Claude',
    icon: TerminalBrowser,
    side: 'incoming',
    avatarInitials: 'CL',
    directClaude: false
  },
  chat_user: {
    label: 'You',
    icon: User01,
    side: 'outgoing',
    avatarInitials: 'YO',
    directClaude: false
  },
  chat_claude: {
    label: 'Claude Code',
    icon: Asterisk02,
    side: 'incoming',
    avatarInitials: 'CC',
    avatarColor: '#d97757',
    directClaude: true
  },
  api: {
    label: 'API',
    icon: Server01,
    side: 'incoming',
    avatarInitials: 'API',
    directClaude: false
  },
};

export const TOAST_TONE_CLASSES: Record<string, string> = {
  neutral: 'border-white/10 bg-white/10 text-secondary backdrop-blur-md',
  success: 'border-white/10 bg-utility-success-50/80 text-success-primary backdrop-blur-md',
  warning: 'border-white/10 bg-utility-warning-50/80 text-warning-primary backdrop-blur-md',
  danger: 'border-white/10 bg-utility-error-50/80 text-error-primary backdrop-blur-md'
};

export const PROCESS_ACTION_BUTTON_CLASS = 'w-24 justify-center';

export const BOARD_COLUMNS = [
  { key: 'missing_status', label: 'Missing Status', statusMatch: null },
  { key: 'not_started', label: 'Not Started', statusMatch: 'not started' },
  { key: 'in_progress', label: 'In Progress', statusMatch: 'in progress' },
  { key: 'done', label: 'Done', statusMatch: 'done' }
] as const;

export const BOARD_PRIORITY_COLORS: Record<string, string> = {
  P0: 'error',
  P1: 'warning',
  P2: 'blue',
  P3: 'gray'
};

export const BOARD_TYPE_COLORS: Record<string, string> = {
  Epic: 'purple',
  UserStory: 'gray',
  Defect: 'error',
  Discovery: 'gray'
};

export const BOARD_POLL_INTERVAL_MS = 30_000;

export const GIT_POLL_INTERVAL_MS = 30_000;

export const GIT_CONVENTIONAL_TYPE_COLORS: Record<string, string> = {
  feat: 'brand',
  fix: 'error',
  refactor: 'purple',
  docs: 'blue',
  style: 'gray',
  perf: 'orange',
  test: 'indigo',
  chore: 'gray',
  ci: 'gray-blue',
  build: 'gray-blue'
};

export const FEED_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});
