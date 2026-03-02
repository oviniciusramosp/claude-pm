// panel/src/components/empty-board-modal.tsx

import React from 'react';
import { Folder, Lightbulb02, X } from '@untitledui/icons';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';

interface EmptyBoardModalProps {
  open: boolean;
  onClose: () => void;
  onIdeaToEpics: () => void;
  onNewEpic: () => void;
}

export function EmptyBoardModal({ open, onClose, onIdeaToEpics, onNewEpic }: EmptyBoardModalProps) {
  return (
    <ModalOverlay isOpen={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Modal>
        <Dialog>
          <div className="relative w-full max-w-lg rounded-2xl bg-primary shadow-xl border border-secondary overflow-hidden">
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute right-4 top-4 z-10 flex size-7 items-center justify-center rounded-md text-quaternary transition hover:bg-secondary hover:text-secondary"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>

            <div className="p-8">
              {/* Header */}
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-50">
                  <Icon icon={Folder} className="size-4 text-brand-600" />
                </span>
                <h2 className="text-lg font-semibold text-primary">Get Started</h2>
              </div>

              <p className="mb-1 text-sm text-secondary">
                This app requires <strong className="text-primary font-semibold">Epics</strong> and <strong className="text-primary font-semibold">Tasks</strong> to work.
              </p>
              <p className="mb-6 text-sm text-tertiary">
                They are stored as <code className="rounded bg-quaternary px-1 py-0.5 text-xs font-mono">.md</code> files inside the{' '}
                <code className="rounded bg-quaternary px-1 py-0.5 text-xs font-mono">Board/</code> folder.
                The easiest way to create them is using one of the options below — the app will optimize the Epic and Task content so Claude performs better.
              </p>

              {/* Option cards */}
              <div className="flex gap-3">
                {/* Idea to Epics */}
                <button
                  onClick={() => { onClose(); onIdeaToEpics(); }}
                  className="group flex flex-1 flex-col items-start gap-4 rounded-xl border border-secondary bg-secondary p-5 text-left transition hover:border-brand-300 hover:bg-brand-25 focus:outline-none focus:ring-2 focus:ring-brand-solid"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50 transition group-hover:bg-brand-100">
                    <Lightbulb02 className="size-6 text-brand-600" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-primary">Idea to Epics</span>
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Recommended</span>
                    </div>
                    <p className="text-sm text-tertiary leading-relaxed">
                      Describe your product ideas in plain language. Claude will ask clarifying questions and generate structured Epics automatically.
                    </p>
                  </div>
                </button>

                {/* New Epic (manual) */}
                <button
                  onClick={() => { onClose(); onNewEpic(); }}
                  className="group flex flex-1 flex-col items-start gap-4 rounded-xl border border-secondary bg-secondary p-5 text-left transition hover:border-secondary hover:bg-primary_hover focus:outline-none focus:ring-2 focus:ring-brand-solid"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary transition group-hover:bg-quaternary">
                    <Folder className="size-6 text-tertiary group-hover:text-secondary" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-primary block mb-1">New Epic</span>
                    <p className="text-sm text-tertiary leading-relaxed">
                      Manually create an Epic and add Tasks inside it. Best when you already know what you want to build.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
