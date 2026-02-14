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
  isPrompt?: boolean;
  promptTitle?: string;
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
