// panel/src/constants.tsx

import {
  Activity,
  AlertCircle,
  Asterisk02,
  Atom01,
  Beaker01,
  CheckCircle,
  Columns03,
  CpuChip02,
  Cube01,
  File03,
  Folder,
  GitCommit,
  Glasses02,
  Globe01,
  InfoCircle,
  LayersThree01,
  LockUnlocked01,
  MessageChatCircle,
  Monitor01,
  Palette,
  Phone01,
  PlayCircle,
  RefreshCw01,
  Server01,
  Settings01,
  SlashCircle01,
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

export interface RecommendedSkill {
  id: string;
  name: string;
  description: string;
  url: string;
  icon: (props: { className?: string }) => unknown;
  /** Directory name under ~/.claude/skills/ to clone into. Defaults to id.
   *  Skills that share the same repo use the same installPath so a single
   *  git-clone covers all of them. */
  installPath?: string;
  platforms: string[]; // empty = available for all platforms
  /** Install method. Defaults to 'git' (git clone full repo).
   *  'npx-skills': installs via `npx skills add` (skills.sh registry).
   *  'github-subdir': clones repo and extracts a specific subdirectory. */
  installMethod?: 'git' | 'npx-skills' | 'github-subdir';
  /** For installMethod='npx-skills': the repo shorthand or URL passed to
   *  `npx skills add`, e.g. 'vercel-labs/agent-skills'. */
  npxRepo?: string;
  /** For installMethod='npx-skills': the --skill flag value. */
  npxSkill?: string;
  /** For installMethod='github-subdir': the subdirectory within the repo to extract. */
  subdir?: string;
  /** Category shown in the filter chips, e.g. 'Design', 'Performance'. */
  category: string;
}

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    description: 'Advanced UI/UX design patterns and best practices for modern interfaces.',
    url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    icon: Columns03,
    platforms: [],
    category: 'Design'
  },
  {
    id: 'expo-app-design',
    name: 'Expo App Design',
    description: 'Build native UIs with Expo Router, DOM components, SwiftUI bridges, and Jetpack Compose.',
    url: 'https://skills.sh/expo/skills/building-native-ui',
    icon: Phone01,
    installPath: 'building-native-ui',
    platforms: ['react-native'],
    installMethod: 'npx-skills',
    npxRepo: 'expo/skills',
    npxSkill: 'building-native-ui',
    category: 'Design'
  },
  {
    id: 'upgrading-expo',
    name: 'Upgrading Expo',
    description: 'Step-by-step guidance for upgrading Expo SDK versions and resolving breaking changes.',
    url: 'https://skills.sh/expo/skills/upgrading-expo',
    icon: RefreshCw01,
    installPath: 'upgrading-expo',
    platforms: ['react-native'],
    installMethod: 'npx-skills',
    npxRepo: 'expo/skills',
    npxSkill: 'upgrading-expo',
    category: 'Tooling'
  },
  {
    id: 'expo-deployment',
    name: 'Expo Deployment',
    description: 'Deploy Expo apps to the App Store and Play Store with EAS Build and EAS Submit.',
    url: 'https://skills.sh/expo/skills/expo-deployment',
    icon: Globe01,
    installPath: 'expo-deployment',
    platforms: ['react-native'],
    installMethod: 'npx-skills',
    npxRepo: 'expo/skills',
    npxSkill: 'expo-deployment',
    category: 'Deployment'
  },
  {
    id: 'react-native-best-practices',
    name: 'React Native Best Practices',
    description: 'Performance optimization guidelines for FPS, TTI, bundle size, memory leaks, re-renders, and animations.',
    url: 'https://github.com/callstackincubator/agent-skills',
    icon: CpuChip02,
    installPath: 'callstack-agent-skills',
    platforms: ['react-native'],
    category: 'Performance'
  },
  {
    id: 'vercel-react-native-skills',
    name: 'Vercel React Native',
    description: 'React Native patterns and tooling from Vercel Labs — routing, data fetching, deployment, and performance.',
    url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-native-skills',
    icon: Monitor01,
    installPath: 'vercel-react-native-skills',
    platforms: ['react-native'],
    installMethod: 'npx-skills',
    npxRepo: 'vercel-labs/agent-skills',
    npxSkill: 'vercel-react-native-skills',
    category: 'Best Practices'
  },
  {
    id: 'web-design-guidelines',
    name: 'Web Design Guidelines',
    description: 'Design guidelines and visual best practices for modern React web applications from Vercel Labs.',
    url: 'https://skills.sh/vercel-labs/agent-skills/web-design-guidelines',
    icon: Palette,
    installPath: 'web-design-guidelines',
    platforms: ['react-web'],
    installMethod: 'npx-skills',
    npxRepo: 'vercel-labs/agent-skills',
    npxSkill: 'web-design-guidelines',
    category: 'Design'
  },
  {
    id: 'vercel-react-best-practices',
    name: 'Vercel React Best Practices',
    description: 'React best practices from Vercel Labs — component design, performance, and scalable patterns.',
    url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
    icon: Atom01,
    installPath: 'vercel-react-best-practices',
    platforms: ['react-web'],
    installMethod: 'npx-skills',
    npxRepo: 'vercel-labs/agent-skills',
    npxSkill: 'vercel-react-best-practices',
    category: 'Best Practices'
  },
  {
    id: 'vercel-composition-patterns',
    name: 'Vercel Composition Patterns',
    description: 'Component composition patterns from Vercel Labs — Server Components, streaming, and data fetching.',
    url: 'https://skills.sh/vercel-labs/agent-skills/vercel-composition-patterns',
    icon: LayersThree01,
    installPath: 'vercel-composition-patterns',
    platforms: ['react-web'],
    installMethod: 'npx-skills',
    npxRepo: 'vercel-labs/agent-skills',
    npxSkill: 'vercel-composition-patterns',
    category: 'Architecture'
  },
  // iOS/Swift skills — AvdLee
  {
    id: 'swiftui-expert-skill',
    name: 'SwiftUI Expert',
    description: 'State management, view composition, performance, and iOS 26+ Liquid Glass adoption.',
    url: 'https://github.com/AvdLee/SwiftUI-Agent-Skill',
    icon: Columns03,
    installPath: 'swiftui-expert-skill',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/AvdLee/SwiftUI-Agent-Skill',
    npxSkill: 'swiftui-expert-skill',
    category: 'UI'
  },
  {
    id: 'swift-testing-expert',
    name: 'Swift Testing Expert',
    description: 'Modern Swift Testing APIs, XCTest migration, parameterized tests, and async parallel execution.',
    url: 'https://github.com/AvdLee/Swift-Testing-Agent-Skill',
    icon: Beaker01,
    installPath: 'swift-testing-expert',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/AvdLee/Swift-Testing-Agent-Skill',
    npxSkill: 'swift-testing-expert',
    category: 'Testing'
  },
  {
    id: 'swift-concurrency',
    name: 'Swift Concurrency',
    description: 'Safe async/await patterns, actor isolation, Sendable safety, and Swift 6+ migration guidance.',
    url: 'https://github.com/AvdLee/Swift-Concurrency-Agent-Skill',
    icon: Activity,
    installPath: 'swift-concurrency',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/AvdLee/Swift-Concurrency-Agent-Skill',
    npxSkill: 'swift-concurrency',
    category: 'Concurrency'
  },
  // iOS/Swift skills — Dimillian
  {
    id: 'ios-debugger-agent',
    name: 'iOS Debugger Agent',
    description: 'Build, run, and debug iOS apps on simulators with UI interaction, log capture, and crash analysis.',
    url: 'https://github.com/Dimillian/Skills',
    icon: TerminalBrowser,
    installPath: 'ios-debugger-agent',
    platforms: ['ios'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'ios-debugger-agent',
    category: 'Tooling'
  },
  {
    id: 'swiftui-liquid-glass',
    name: 'SwiftUI Liquid Glass',
    description: 'Implement native Liquid Glass API in SwiftUI interfaces for iOS 26+ and visionOS.',
    url: 'https://github.com/Dimillian/Skills',
    icon: Palette,
    installPath: 'swiftui-liquid-glass',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'swiftui-liquid-glass',
    category: 'UI'
  },
  {
    id: 'swiftui-ui-patterns',
    name: 'SwiftUI UI Patterns',
    description: 'View composition, state ownership, and component selection guidance for SwiftUI apps.',
    url: 'https://github.com/Dimillian/Skills',
    icon: LayersThree01,
    installPath: 'swiftui-ui-patterns',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'swiftui-ui-patterns',
    category: 'Architecture'
  },
  {
    id: 'swiftui-view-refactor',
    name: 'SwiftUI View Refactor',
    description: 'Standardize view structure, enforce MVVM patterns, and improve dependency injection in SwiftUI.',
    url: 'https://github.com/Dimillian/Skills',
    icon: RefreshCw01,
    installPath: 'swiftui-view-refactor',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'swiftui-view-refactor',
    category: 'Architecture'
  },
  {
    id: 'swiftui-performance-audit',
    name: 'SwiftUI Performance Audit',
    description: 'Identify and remediate SwiftUI rendering bottlenecks, redundant updates, and layout issues.',
    url: 'https://github.com/Dimillian/Skills',
    icon: CpuChip02,
    installPath: 'swiftui-performance-audit',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'swiftui-performance-audit',
    category: 'Performance'
  },
  {
    id: 'app-store-changelog',
    name: 'App Store Changelog',
    description: 'Generate user-facing App Store release notes from git history following Apple guidelines.',
    url: 'https://github.com/Dimillian/Skills',
    icon: File03,
    installPath: 'app-store-changelog',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'app-store-changelog',
    category: 'Tooling'
  },
  {
    id: 'swift-concurrency-expert',
    name: 'Swift Concurrency Expert',
    description: 'Deep review and fixes for Swift 6.2+ concurrency, actor isolation, and data-race safety.',
    url: 'https://github.com/Dimillian/Skills',
    icon: Activity,
    installPath: 'swift-concurrency-expert',
    platforms: ['ios', 'visionos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'swift-concurrency-expert',
    category: 'Concurrency'
  },
  // iOS/Swift skills — oviniciusramosp
  {
    id: 'ios-swiftui-core',
    name: 'iOS SwiftUI Core',
    description: 'Data persistence, concurrency, location, maps, weather, widgets, Vision/CoreML, camera, and accessibility for SwiftUI apps.',
    url: 'https://github.com/oviniciusramosp/ios-claude-skills',
    icon: Phone01,
    installPath: 'ios-swiftui-core',
    platforms: ['ios', 'visionos'],
    installMethod: 'github-subdir',
    subdir: 'ios-swiftui-core',
    category: 'Core'
  },
  {
    id: 'ios-ar-games',
    name: 'AR & RealityKit',
    description: 'ARKit, RealityKit, Metal, physics simulation, game loops, and entity-component systems. Central to visionOS development.',
    url: 'https://github.com/oviniciusramosp/ios-claude-skills',
    icon: CpuChip02,
    installPath: 'ios-ar-games',
    platforms: ['ios', 'visionos'],
    installMethod: 'github-subdir',
    subdir: 'ios-ar-games',
    category: 'AR & Spatial'
  },
  {
    id: 'ios-audio-music',
    name: 'iOS Audio & Music',
    description: 'AVFoundation, AVAudioEngine, CoreMIDI, SoundAnalysis, ShazamKit, and Speech for audio processing and music production.',
    url: 'https://github.com/oviniciusramosp/ios-claude-skills',
    icon: Activity,
    installPath: 'ios-audio-music',
    platforms: ['ios'],
    installMethod: 'github-subdir',
    subdir: 'ios-audio-music',
    category: 'Audio'
  },
  // macOS skills — Dimillian
  {
    id: 'macos-spm-app-packaging',
    name: 'macOS SPM Packaging',
    description: 'Scaffold and package macOS SwiftPM apps without Xcode project files.',
    url: 'https://github.com/Dimillian/Skills',
    icon: Monitor01,
    installPath: 'macos-spm-app-packaging',
    platforms: ['macos'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'macos-spm-app-packaging',
    category: 'Tooling'
  },
  // React Web skills — Dimillian
  {
    id: 'react-component-performance',
    name: 'React Component Performance',
    description: 'Optimize React rendering, reduce unnecessary re-renders, and improve component efficiency.',
    url: 'https://github.com/Dimillian/Skills',
    icon: CpuChip02,
    installPath: 'react-component-performance',
    platforms: ['react-web'],
    installMethod: 'npx-skills',
    npxRepo: 'https://github.com/Dimillian/Skills',
    npxSkill: 'react-component-performance',
    category: 'Performance'
  }
];

export interface RecommendedMcp {
  id: string;
  name: string;
  description: string;
  url: string;
  icon: (props: { className?: string }) => unknown;
  platforms: string[];
  /** The command to run (e.g., 'xcrun', 'npx', 'uvx'). */
  command: string;
  /** Arguments for the command. */
  args: string[];
  /** Category shown in the filter chips. */
  category: string;
  /** Prerequisite tool that must be available before installing. */
  prerequisite?: {
    /** The command to check (e.g., 'uvx'). */
    command: string;
    /** Shell command to auto-install the prerequisite (e.g., 'brew install uv'). */
    installCommand?: string;
    /** Human-readable label for the prerequisite (e.g., 'uv'). */
    label: string;
    /** Hint shown if auto-install is not available. */
    installHint?: string;
  };
}

export const RECOMMENDED_MCPS: RecommendedMcp[] = [
  {
    id: 'xcode',
    name: 'Xcode MCP',
    description: 'Apple\'s official MCP server — build, test, and debug Xcode projects directly from Claude. Requires Xcode 26+.',
    url: 'https://developer.apple.com/xcode/',
    icon: TerminalBrowser,
    platforms: ['ios', 'visionos', 'macos'],
    command: 'xcrun',
    args: ['mcpbridge'],
    category: 'Build & Debug',
    prerequisite: {
      command: 'xcrun',
      label: 'Xcode Command Line Tools',
      installHint: 'Run: xcode-select --install'
    }
  },
  {
    id: 'axiom',
    name: 'Axiom',
    description: '133 iOS development skills — Metal shaders, Vision framework, RealityKit, SwiftUI, concurrency, and more.',
    url: 'https://github.com/charleswiltgen/axiom',
    icon: CpuChip02,
    platforms: ['ios', 'visionos', 'macos'],
    command: 'npx',
    args: ['-y', 'axiom-mcp'],
    category: 'iOS Expertise',
    prerequisite: {
      command: 'npx',
      label: 'Node.js',
      installCommand: 'brew install node',
      installHint: 'Install Node.js from https://nodejs.org'
    }
  },
  {
    id: 'blender',
    name: 'Blender MCP',
    description: 'AI-assisted 3D modeling and scene manipulation in Blender. Create assets for RealityKit and visionOS.',
    url: 'https://github.com/ahujasid/blender-mcp',
    icon: Cube01,
    platforms: ['visionos'],
    command: 'uvx',
    args: ['blender-mcp'],
    category: '3D & Assets',
    prerequisite: {
      command: 'uvx',
      label: 'uv',
      installCommand: 'brew install uv',
      installHint: 'Install uv: https://docs.astral.sh/uv/'
    }
  }
];

export const PLATFORM_PRESETS = [
  { value: '', label: 'None', description: 'No platform-specific instructions', icon: SlashCircle01 },
  { value: 'ios', label: 'iOS / iPadOS', description: 'Simulator management, xcodebuild flags, crash recovery', icon: Phone01 },
  { value: 'visionos', label: 'visionOS', description: 'Apple Vision Pro simulator, RealityKit patterns, spatial SwiftUI, and Xcode MCP setup', icon: Glasses02 },
  { value: 'macos', label: 'macOS', description: 'SwiftPM app packaging, AppKit patterns, and macOS-specific tooling', icon: Monitor01 },
  { value: 'react-native', label: 'React Native (Android / iOS)', description: 'Cross-platform mobile with Expo or bare React Native', icon: Atom01 },
  { value: 'android', label: 'Android', description: 'Android native development with Gradle and ADB tooling', icon: Monitor01, disabled: true, badge: { text: 'Soon', color: 'gray' } },
  { value: 'react-web', label: 'React Web', description: 'React web apps with Vite, Next.js, or Create React App', icon: Globe01 }
];

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
      bulletList: true,
      steps: [
        'Use Automatic to use the model specified in each task.',
        'Or select a model to override all task models.'
      ]
    },
    selectOptions: CLAUDE_MODELS
  },
  {
    key: 'PLATFORM_PRESET',
    label: 'Platform Preset',
    icon: Server01,
    placeholder: '',
    description: 'Injects platform-specific instructions into the target project CLAUDE.md.',
    help: {
      title: 'Platform Presets',
      summary: 'Add platform-specific guidance for Claude when executing tasks.',
      steps: [
        'Select a platform to inject best-practice instructions.',
        'iOS: Simulator health checks, xcodebuild flags, crash recovery, build patterns.',
        'Instructions are injected into the managed CLAUDE.md section on each API restart.'
      ]
    },
    selectOptions: PLATFORM_PRESETS
  }
];

export const TOGGLE_CONFIG: ToggleConfig[] = [
  {
    key: 'CLAUDE_FULL_ACCESS',
    label: 'Allow Claude Full Access',
    icon: LockUnlocked01,
    description: 'Lets Claude run task commands without extra permission prompts.',
    warning: 'This grants Claude unrestricted access to execute commands, modify files, and install packages in the working directory without asking for confirmation. Only enable this if you trust the tasks in your queue and understand the risks.',
    required: true
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
    toggleKeys: []
  },
  {
    key: 'platform',
    title: 'Platform',
    description: 'Platform-specific instructions injected into the target project.',
    textKeys: ['PLATFORM_PRESET'],
    toggleKeys: []
  },
  {
    key: 'execution',
    title: 'Execution',
    description: 'Controls how Claude executes tasks, including multi-agent and review options.',
    textKeys: [],
    toggleKeys: ['CLAUDE_FULL_ACCESS', 'ENABLE_MULTI_AGENTS', 'OPUS_REVIEW_ENABLED', 'EPIC_REVIEW_ENABLED']
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

export const TOAST_PROGRESS_CLASSES: Record<string, string> = {
  neutral: 'bg-white/30',
  success: 'bg-success-primary/50',
  warning: 'bg-warning-primary/50',
  danger: 'bg-error-primary/50'
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
  P2: 'orange',
  P3: 'success'
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
