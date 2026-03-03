// panel/src/components/epics-onboarding-modal.tsx

import React from 'react';
import { Edit05, Plus, Stars01, X } from '@untitledui/icons';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';

interface EpicsOnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

export function EpicsOnboardingModal({ open, onClose }: EpicsOnboardingModalProps) {
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
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-utility-brand-50">
                  <Icon icon={Stars01} className="size-4 text-brand-600" />
                </span>
                <h2 className="text-lg font-semibold text-primary">Your Epics Are Ready</h2>
              </div>

              <p className="mb-1 text-sm text-secondary">
                Now it's time to add <strong className="text-primary font-semibold">Tasks</strong> to your Epics.
              </p>
              <p className="mb-6 text-sm text-tertiary">
                Each Epic card has action buttons at the bottom — here's how to use them:
              </p>

              {/* Option cards */}
              <div className="flex flex-col gap-3">
                {/* Generate with AI */}
                <div className="group flex w-full items-center gap-4 rounded-xl border border-secondary bg-secondary p-5 text-left">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50">
                    <Stars01 className="size-6 text-brand-600" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-primary">Generate with AI</span>
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Recommended</span>
                    </div>
                    <p className="text-xs text-tertiary leading-relaxed">
                      Click the <span className="inline-flex items-center gap-0.5 rounded bg-quaternary px-1.5 py-0.5 text-[10px] font-medium text-secondary"><Stars01 className="size-2.5" /> Generate</span> button below any Epic card.
                      Claude will read the Epic description and automatically create optimized Tasks with acceptance criteria, technical steps, and tests.
                    </p>
                  </div>
                </div>

                {/* Create Manually + Review */}
                <div className="group flex w-full items-center gap-4 rounded-xl border border-secondary bg-secondary p-5 text-left">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <div className="flex items-center -space-x-1">
                      <Plus className="size-5 text-tertiary" />
                      <Edit05 className="size-4 text-tertiary" />
                    </div>
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-primary block mb-1">Create Manually + Review</span>
                    <p className="text-xs text-tertiary leading-relaxed">
                      Click the <span className="inline-flex items-center gap-0.5 rounded bg-quaternary px-1.5 py-0.5 text-[10px] font-medium text-secondary"><Plus className="size-2.5" /></span> button to add a Task manually.
                      Write your description, then use <strong className="text-secondary font-medium">Review with Claude</strong> inside the editor — Claude will optimize your acceptance criteria and structure.
                    </p>
                  </div>
                </div>
              </div>

              {/* Dismiss button */}
              <button
                onClick={onClose}
                className="mt-6 w-full rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-solid_hover focus:outline-none focus:ring-2 focus:ring-brand-solid focus:ring-offset-2"
              >
                Got it
              </button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
