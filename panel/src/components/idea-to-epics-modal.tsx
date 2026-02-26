// panel/src/components/idea-to-epics-modal.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb02, Send01, RefreshCw01, X } from '@untitledui/icons';
import { marked } from 'marked';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Icon } from './icon';
import { DiscardConfirmOverlay } from './discard-confirm-overlay';

interface IdeaToEpicsModalProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  onCreated: () => void;
  onShowErrorDetail?: (title: string, message: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const SYSTEM_WELCOME = `Describe your product ideas, features, and goals. I'll help you organize them into well-structured Epics for your board.

You can describe:
- What your product does
- Who the target users are
- Key features you want to build
- Any technical preferences or constraints

I'll ask clarifying questions to help refine your ideas before creating Epics.`;

export function IdeaToEpicsModal({ open, onClose, apiBaseUrl, showToast, onCreated, onShowErrorDetail }: IdeaToEpicsModalProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'system', content: SYSTEM_WELCOME }]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSessionId(null);
      setMessages([{ role: 'system', content: SYSTEM_WELCOME }]);
      setDraft('');
      setSending(false);
      setGenerating(false);
      setConfirmCloseOpen(false);
    }
  }, [open]);

  const isDirty = useMemo(() => messages.length > 1, [messages]);
  const hasConversation = useMemo(() => messages.some(m => m.role === 'assistant'), [messages]);

  const handleCloseAttempt = useCallback(() => {
    if (sending || generating || isDirty) {
      setConfirmCloseOpen(true);
    } else {
      onClose();
    }
  }, [sending, generating, isDirty, onClose]);

  const handleConfirmDiscard = useCallback(async () => {
    // Clean up session on server
    if (sessionId) {
      try {
        await fetch(`${apiBaseUrl}/api/ideas/delete-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
      } catch {
        // Ignore cleanup errors
      }
    }
    setConfirmCloseOpen(false);
    onClose();
  }, [sessionId, apiBaseUrl, onClose]);

  const handleSend = useCallback(async () => {
    const msg = draft.trim();
    if (!msg || sending || generating) return;

    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setDraft('');
    setSending(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/ideas/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: msg })
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data?.message || `Request failed (${response.status})`;
        showToast(errMsg, 'danger');
        // Remove the user message since it failed
        setMessages(prev => prev.slice(0, -1));
        setDraft(msg);
        return;
      }

      if (data.ok) {
        setSessionId(data.sessionId);
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        showToast(data.message || 'Failed to get response', 'danger');
        setMessages(prev => prev.slice(0, -1));
        setDraft(msg);
      }
    } catch (error: any) {
      showToast(`Network error: ${error.message}`, 'danger');
      setMessages(prev => prev.slice(0, -1));
      setDraft(msg);
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [draft, sending, generating, sessionId, apiBaseUrl, showToast]);

  const handleGenerateEpics = useCallback(async () => {
    if (!sessionId || generating || sending) return;

    setGenerating(true);
    setMessages(prev => [...prev, { role: 'system', content: 'Generating Epics from our conversation...' }]);

    try {
      const response = await fetch(`${apiBaseUrl}/api/ideas/generate-epics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data?.message || `Request failed (${response.status})`;
        if (onShowErrorDetail) {
          onShowErrorDetail('Epic generation failed', errMsg);
        }
        showToast('Failed to generate Epics', 'danger');
        // Remove the "generating" system message
        setMessages(prev => prev.slice(0, -1));
        return;
      }

      if (data.ok) {
        const count = data.created?.length || 0;
        const failedCount = data.failed || 0;
        const names = data.created?.map((e: any) => e.name).join(', ') || '';

        showToast(
          `Created ${count} Epic${count !== 1 ? 's' : ''}${failedCount > 0 ? ` (${failedCount} failed)` : ''}: ${names}`,
          failedCount > 0 ? 'warning' : 'success'
        );
        onCreated();
        onClose();
      } else {
        if (onShowErrorDetail) {
          onShowErrorDetail('Epic generation failed', data.message || 'Unknown error');
        }
        showToast('Failed to generate Epics', 'danger');
        setMessages(prev => prev.slice(0, -1));
      }
    } catch (error: any) {
      showToast(`Network error: ${error.message}`, 'danger');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setGenerating(false);
    }
  }, [sessionId, generating, sending, apiBaseUrl, showToast, onCreated, onClose, onShowErrorDetail]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-resize textarea
  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  return (
    <>
      <ModalOverlay isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleCloseAttempt(); }} isDismissable={!sending && !generating}>
        <Modal className="sm:max-w-2xl">
          <Dialog>
            <div className="flex w-full flex-col rounded-xl border border-secondary bg-primary shadow-2xl" style={{ maxHeight: '85vh' }}>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-secondary px-6 py-4">
                <div className="flex items-center gap-2">
                  <Icon icon={Lightbulb02} className="size-5 text-warning" />
                  <h3 className="text-lg font-semibold text-primary">Idea to Epics</h3>
                </div>
                <button
                  onClick={handleCloseAttempt}
                  className="rounded-sm p-1 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4" style={{ minHeight: '300px', maxHeight: '55vh' }}>
                {messages.map((msg, i) => (
                  <MessageBubble key={i} message={msg} />
                ))}

                {/* Typing indicator */}
                {sending && (
                  <div className="flex items-start gap-2">
                    <div className="rounded-lg rounded-tl-sm bg-secondary px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="size-2 animate-bounce rounded-full bg-quaternary" style={{ animationDelay: '0ms' }} />
                        <span className="size-2 animate-bounce rounded-full bg-quaternary" style={{ animationDelay: '150ms' }} />
                        <span className="size-2 animate-bounce rounded-full bg-quaternary" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-secondary px-6 py-4 space-y-3">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={handleTextareaInput}
                    onKeyDown={handleKeyDown}
                    placeholder={hasConversation ? 'Type your response...' : 'Describe your product ideas...'}
                    className="flex-1 resize-none rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary placeholder:text-placeholder focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    rows={2}
                    style={{ minHeight: '60px', maxHeight: '200px' }}
                    disabled={sending || generating}
                  />
                  <Button
                    size="sm"
                    color="brand"
                    onClick={handleSend}
                    isDisabled={!draft.trim() || sending || generating}
                    aria-label="Send message"
                    className="shrink-0"
                  >
                    {sending ? (
                      <RefreshCw01 className="size-4 animate-spin" />
                    ) : (
                      <Send01 className="size-4" />
                    )}
                  </Button>
                </div>

                {/* Generate Epics button */}
                <Button
                  size="md"
                  color="brand"
                  onClick={handleGenerateEpics}
                  isDisabled={!hasConversation || sending || generating}
                  className="w-full"
                >
                  {generating ? (
                    <>
                      <RefreshCw01 className="size-4 animate-spin" />
                      <span className="ml-2">Generating Epics...</span>
                    </>
                  ) : (
                    <>
                      <Lightbulb02 className="size-4" />
                      <span className="ml-2">Generate Epics</span>
                    </>
                  )}
                </Button>

                <p className="text-center text-xs text-quaternary">
                  Press Enter to send, Shift+Enter for new line
                </p>
              </div>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>

      <DiscardConfirmOverlay
        open={confirmCloseOpen}
        reviewing={sending || generating}
        onKeepEditing={() => setConfirmCloseOpen(false)}
        onDiscard={handleConfirmDiscard}
      />
    </>
  );
}

// ── Chat Message Bubble ──────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="max-w-md rounded-lg bg-tertiary px-4 py-3 text-center text-sm text-secondary">
          <div
            className="prose prose-sm max-w-none text-secondary [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0"
            dangerouslySetInnerHTML={{ __html: marked.parse(message.content, { async: false, gfm: true, breaks: true }) as string }}
          />
        </div>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-tr-sm bg-brand-600 px-4 py-3 text-sm text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-lg rounded-tl-sm bg-secondary px-4 py-3 text-sm text-primary">
        <div
          className="prose prose-sm max-w-none text-primary [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0 [&_strong]:text-primary [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm"
          dangerouslySetInnerHTML={{ __html: marked.parse(message.content, { async: false, gfm: true, breaks: true }) as string }}
        />
      </div>
    </div>
  );
}
