// panel/src/components/help-modal.tsx

import { BookOpen01, CheckCircle, Clipboard, Columns03, GitCommit, Play, Server01, Settings01, TerminalBrowser, X, Zap } from '@untitledui/icons';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { handleModalKeyDown } from '@/utils/modal-keyboard';

interface Section {
  icon: React.ComponentType<any>;
  title: string;
  color: string;
  items: string[];
}

const SECTIONS: Section[] = [
  {
    icon: Settings01,
    title: 'Setup',
    color: 'text-blue-500',
    items: [
      'Configure your Claude OAuth token and working directory.',
      'The working directory is where your project lives — not the Product Manager folder.',
      'After saving, the API service can be restarted from the sidebar.',
    ],
  },
  {
    icon: Columns03,
    title: 'Board',
    color: 'text-violet-500',
    items: [
      'Tasks live as .md files with YAML frontmatter inside Board/ in your project.',
      'Three columns: Not Started, In Progress, Done — status is tracked in frontmatter.',
      'Create standalone tasks or group related tasks into Epics (sub-folders).',
      'Each card shows a donut chart with Acceptance Criteria progress.',
      'Drag cards between columns, or use "Review with Claude" to improve task quality.',
      'Generate Stories: click the ✦ button on an Epic card to auto-generate user stories.',
    ],
  },
  {
    icon: TerminalBrowser,
    title: 'Feed',
    color: 'text-emerald-500',
    items: [
      'Live log stream — all output from the orchestrator, Claude, and the API.',
      'Color-coded by source: Panel, API, Claude, Chat.',
      'AC completions appear as success messages in real time.',
      'Use the chat input at the bottom to send one-shot prompts to Claude.',
    ],
  },
  {
    icon: GitCommit,
    title: 'Git',
    color: 'text-orange-500',
    items: [
      'View recent commits and diffs in your working directory.',
      'Click any commit to see full details and changed files.',
    ],
  },
  {
    icon: Play,
    title: 'Running the automation',
    color: 'text-brand',
    items: [
      'Click "Start API" to launch the orchestrator.',
      'Click "Start Working" to trigger a reconciliation and pick up the next task.',
      'The orchestrator picks one Not Started task, moves it to In Progress, runs Claude, then moves it to Done.',
      'Use "Pause" to hold the queue after the current task finishes.',
    ],
  },
  {
    icon: CheckCircle,
    title: 'Acceptance Criteria',
    color: 'text-teal-500',
    items: [
      'Define ACs as checkboxes (- [ ] ...) in the task body.',
      'Claude checks them off as it works — progress is never lost if a task fails mid-run.',
      'A task is only moved to Done when all ACs are checked.',
    ],
  },
  {
    icon: Zap,
    title: 'Tips',
    color: 'text-yellow-500',
    items: [
      'Fewer, larger tasks work better than many micro-tasks.',
      'Use Haiku for mechanical work, Sonnet for most tasks, Opus for discovery and complex reasoning.',
      'Set model: claude-sonnet-4-5-20250929 (or haiku/opus) in task frontmatter to override the default.',
      'Enable Auto-Recovery in .env so failed tasks are analysed and retried automatically.',
    ],
  },
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      isDismissable
      className="!overflow-hidden"
    >
      <Modal className="sm:max-w-2xl">
        <Dialog onKeyDown={(e) => handleModalKeyDown(e, onClose)}>
          <div className="flex max-h-[85vh] w-full flex-col rounded-xl border border-secondary bg-primary shadow-2xl">

            {/* Header */}
            <div className="flex shrink-0 items-center gap-3 border-b border-secondary px-6 py-4">
              <div className="flex size-9 items-center justify-center rounded-lg bg-brand-secondary">
                <Icon icon={BookOpen01} className="size-5 text-brand-primary" />
              </div>
              <div className="flex-1">
                <h3 className="m-0 text-base font-semibold text-primary">How it works</h3>
                <p className="mt-0.5 text-xs text-tertiary">Quick guide to PM Automation</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-quaternary transition hover:bg-primary_hover hover:text-secondary"
                aria-label="Close"
              >
                <Icon icon={X} className="size-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-6">
                {SECTIONS.map((section) => (
                  <div key={section.title}>
                    <div className="mb-2.5 flex items-center gap-2">
                      <Icon icon={section.icon} className={`size-4 shrink-0 ${section.color}`} />
                      <h4 className="text-sm font-semibold text-primary">{section.title}</h4>
                    </div>
                    <ul className="space-y-1.5 pl-6">
                      {section.items.map((item) => (
                        <li key={item} className="text-sm text-secondary">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Footer note */}
              <div className="mt-6 rounded-lg border border-secondary bg-secondary px-4 py-3 text-xs text-tertiary">
                Full documentation is in <span className="font-mono text-secondary">CLAUDE.md</span> at the project root.
              </div>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
