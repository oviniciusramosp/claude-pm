// panel/src/components/empty-board-modal.tsx

import React from 'react';
import { Folder, Lightbulb02, X, ArrowRight } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
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
                <h2 className="text-lg font-semibold text-primary">Como começar</h2>
              </div>

              <p className="mb-1 text-sm text-secondary">
                O app precisa de <strong className="text-primary font-semibold">Epics</strong> e <strong className="text-primary font-semibold">Tasks</strong> para funcionar.
              </p>
              <p className="mb-6 text-sm text-tertiary">
                Eles são armazenados como arquivos <code className="rounded bg-quaternary px-1 py-0.5 text-xs font-mono">.md</code> dentro da pasta{' '}
                <code className="rounded bg-quaternary px-1 py-0.5 text-xs font-mono">Board/</code>.
                A forma mais fácil de criar é usando uma das opções abaixo — o app vai otimizar a escrita dos Epics e Tasks para o Claude funcionar melhor.
              </p>

              {/* Option cards */}
              <div className="flex flex-col gap-3">
                {/* Idea to Epics */}
                <button
                  onClick={() => { onClose(); onIdeaToEpics(); }}
                  className="group flex w-full items-start gap-5 rounded-xl border border-secondary bg-secondary p-5 text-left transition hover:border-brand-300 hover:bg-brand-25 focus:outline-none focus:ring-2 focus:ring-brand-solid"
                >
                  <span className="mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 transition group-hover:bg-brand-100">
                    <Lightbulb02 className="size-6 text-brand-600" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-primary">Idea to Epics</span>
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Recomendado</span>
                    </div>
                    <p className="mt-1 text-sm text-tertiary leading-relaxed">
                      Descreva suas ideias de produto em linguagem natural. O Claude vai fazer perguntas e gerar os Epics estruturados automaticamente.
                    </p>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-quaternary transition group-hover:text-brand-600" />
                </button>

                {/* New Epic (manual) */}
                <button
                  onClick={() => { onClose(); onNewEpic(); }}
                  className="group flex w-full items-start gap-5 rounded-xl border border-secondary bg-secondary p-5 text-left transition hover:border-secondary hover:bg-primary_hover focus:outline-none focus:ring-2 focus:ring-brand-solid"
                >
                  <span className="mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-xl bg-secondary transition group-hover:bg-quaternary">
                    <Folder className="size-6 text-tertiary group-hover:text-secondary" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-primary">Novo Epic</span>
                    <p className="mt-1 text-sm text-tertiary leading-relaxed">
                      Crie um Epic manualmente e adicione as Tasks dentro dele. Bom quando você já sabe exatamente o que quer construir.
                    </p>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-quaternary transition group-hover:text-secondary" />
                </button>
              </div>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
