// panel/src/components/help-modal.tsx

import { BookOpen01, Columns03, GitCommit, Play, Settings01, TerminalBrowser, X } from '@untitledui/icons';
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
      'Tell the app where your project lives and paste your Claude token. Once saved, head to the Board.',
    ],
  },
  {
    icon: Columns03,
    title: 'Board',
    color: 'text-violet-500',
    items: [
      'Tasks are cards that describe work you want Claude to execute. Each task needs Acceptance Criteria — Claude reads them and checks each one off as it goes, and only marks the task as Done when all are complete.',
      'Group related tasks into an Epic. Got a big idea? Use "Idea to Epic" to describe it in plain language and let Claude turn it into a structured Epic with a clear scope.',
      'Inside an Epic, click "Generate Tasks" to have Claude break the Epic down into individual tasks automatically.',
      'Before running a task, click "Review with Claude" to let Claude improve the description, sharpen the acceptance criteria, and catch anything missing.',
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
    icon: TerminalBrowser,
    title: 'Feed',
    color: 'text-emerald-500',
    items: [
      'This is where you watch Claude work in real time. You can see it thinking, writing code, running commands, and checking off acceptance criteria as each one is completed.',
      'If something goes wrong or you\'re curious about what happened, the full output is here.',
      'You can also type directly in the chat box at the bottom to ask Claude questions or give it quick instructions mid-session.',
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
