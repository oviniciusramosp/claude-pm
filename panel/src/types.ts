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
    steps: React.ReactNode[];
  };
  password?: boolean;
  folderPicker?: boolean;
}

export interface ToggleConfig {
  key: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  description: string;
  warning?: string;
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
  isPrompt?: boolean;
  promptTitle?: string;
}

export interface Toast {
  id: string;
  message: string;
  color: 'success' | 'warning' | 'danger' | 'neutral';
}

export type ToastState = Toast[];

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

export interface TaskContractData {
  status: 'done' | 'blocked';
  summary: string;
  notes: string;
  files: string[];
  tests: string;
}

export interface OrchestratorState {
  active: boolean;
  currentTaskId: string | null;
  currentTaskName: string | null;
  queuedReasons: string[];
  halted: boolean;
}

export interface BoardTask {
  id: string;
  name: string;
  status: string;
  agents: string[];
  priority: string;
  type: string;
  model: string;
  parentId: string | null;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  acTotal: number;
  acDone: number;
}
