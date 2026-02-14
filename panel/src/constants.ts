// panel/src/constants.ts

import {
  Activity,
  AlertCircle,
  CheckCircle,
  Database01,
  File03,
  Folder,
  InfoCircle,
  Key01,
  LockUnlocked01,
  MessageChatCircle,
  Server01,
  Settings01,
  TerminalBrowser,
  User01,
  XCircle
} from '@untitledui/icons';
import type { TextFieldConfig, ToggleConfig, SetupSection, LogLevelMeta, LogSourceMeta } from './types';

export const TEXT_FIELD_CONFIG: TextFieldConfig[] = [
  {
    key: 'NOTION_API_TOKEN',
    label: 'Notion API Token',
    icon: Key01,
    placeholder: 'ntn_... or secret_...',
    description: 'Used to read and update tasks in your Notion database.',
    help: {
      title: 'How to get Notion API Token',
      summary: 'Create a Notion integration and copy its internal token.',
      steps: [
        'Open Notion and go to Settings & members > Connections.',
        'Create or open an internal integration.',
        'Copy the integration token and paste it here.',
        'Share your target database with this integration and grant edit access.'
      ]
    },
    password: true
  },
  {
    key: 'NOTION_DATABASE_ID',
    label: 'Notion Database ID',
    icon: Database01,
    placeholder: '32-char database id or UUID with hyphens',
    description: 'Identifies which Notion database is used as your Kanban board.',
    help: {
      title: 'How to find Notion Database ID',
      summary: 'Use the URL of your Notion database page.',
      steps: [
        'Open the database in Notion.',
        'Copy the URL from your browser.',
        'Find the long ID segment in the URL (with or without hyphens).',
        'Paste that value here.'
      ]
    }
  },
  {
    key: 'CLAUDE_CODE_OAUTH_TOKEN',
    label: 'Claude OAuth Token',
    icon: User01,
    placeholder: 'sk-ant-...',
    description: 'Allows Claude to run in non-interactive mode.',
    help: {
      title: 'How to get Claude OAuth Token',
      summary: 'Generate a token from Claude CLI on your machine.',
      steps: ['Run: /opt/homebrew/bin/claude setup-token', 'Copy the generated token.', 'Paste the token in this field.']
    },
    password: true
  },
  {
    key: 'CLAUDE_WORKDIR',
    label: 'Claude Working Directory',
    icon: Folder,
    placeholder: '/Users/you/your-project',
    description: 'Folder where Claude will run commands and modify files.',
    help: {
      title: 'How to choose Claude Working Directory',
      summary: 'Pick the repository folder Claude should work on.',
      steps: [
        'Use Choose Folder to select a local directory.',
        'Or type a path manually.',
        'The automation will execute Claude commands in this folder.'
      ]
    },
    folderPicker: true
  }
];

export const TOGGLE_CONFIG: ToggleConfig[] = [
  {
    key: 'CLAUDE_FULL_ACCESS',
    label: 'Allow Claude Full Access',
    icon: LockUnlocked01,
    description: 'Lets Claude run task commands without extra permission prompts.'
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
  }
];

export const TEXT_FIELD_KEYS = TEXT_FIELD_CONFIG.map((field) => field.key);
export const TOGGLE_KEYS = TOGGLE_CONFIG.map((field) => field.key);
export const TEXT_FIELD_BY_KEY = Object.fromEntries(TEXT_FIELD_CONFIG.map((field) => [field.key, field]));
export const TOGGLE_BY_KEY = Object.fromEntries(TOGGLE_CONFIG.map((field) => [field.key, field]));

export const SETUP_SECTIONS: SetupSection[] = [
  {
    key: 'notion',
    title: 'Notion',
    description: 'Credentials and database settings.',
    textKeys: ['NOTION_API_TOKEN', 'NOTION_DATABASE_ID'],
    toggleKeys: []
  },
  {
    key: 'claude',
    title: 'Claude Runner',
    description: 'Authentication, command, and workspace configuration.',
    textKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_WORKDIR'],
    toggleKeys: ['CLAUDE_FULL_ACCESS']
  },
  {
    key: 'execution',
    title: 'Execution & Logs',
    description: 'Controls terminal streaming and prompt logging for task runs.',
    textKeys: [],
    toggleKeys: ['CLAUDE_STREAM_OUTPUT', 'CLAUDE_LOG_PROMPT']
  }
];

export const LABEL_BY_KEY = Object.fromEntries([...TEXT_FIELD_CONFIG, ...TOGGLE_CONFIG].map((field) => [field.key, field.label]));

export const NAV_TAB_KEYS = {
  setup: 'setup',
  operations: 'operations'
} as const;

export const CLAUDE_CHAT_MAX_CHARS = 12000;
export const CLAUDE_CODE_AVATAR_URL = 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Claude_AI_symbol.svg';

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
    label: 'Panel',
    icon: Settings01,
    side: 'outgoing',
    avatarInitials: 'PN',
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
    icon: MessageChatCircle,
    side: 'incoming',
    avatarUrl: CLAUDE_CODE_AVATAR_URL,
    avatarInitials: 'CC',
    directClaude: true
  },
  api: {
    label: 'Automation App',
    icon: Server01,
    side: 'incoming',
    avatarInitials: 'AA',
    directClaude: false
  },
};

export const TOAST_TONE_CLASSES: Record<string, string> = {
  neutral: 'border-secondary bg-primary text-secondary',
  success: 'border-transparent bg-utility-success-50 text-success-primary',
  warning: 'border-transparent bg-utility-warning-50 text-warning-primary',
  danger: 'border-transparent bg-utility-error-50 text-error-primary'
};

export const PROCESS_ACTION_BUTTON_CLASS = 'w-24 justify-center';

export const FEED_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});
