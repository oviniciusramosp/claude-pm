// panel/src/components/idea-to-epics-modal.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb02, Send01, RefreshCw01, X, Edit05, Check, File06 } from '@untitledui/icons';
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

The plan will build up on the right as we discuss. You can also edit it directly.

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

  // Plan state
  const [plan, setPlan] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [planDirty, setPlanDirty] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageCountAtLoad = useRef(1); // Track initial message count to detect new changes

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 100);
    }
  }, [open]);

  // Load saved session or reset state when modal opens
  useEffect(() => {
    if (!open) return;

    // Reset to clean defaults first
    setDraft('');
    setIsEditing(false);
    setEditDraft('');
    setPlanDirty(false);
    setSending(false);
    setGenerating(false);
    setConfirmCloseOpen(false);

    // Try to restore a saved session from disk
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/ideas/session`);
        const data = await res.json();
        if (data.ok && data.exists && data.sessionId) {
          setSessionId(data.sessionId);
          // Rebuild messages: system welcome + saved conversation
          const restored: ChatMessage[] = [{ role: 'system', content: SYSTEM_WELCOME }];
          for (const m of (data.messages || [])) {
            if (m.role === 'user' || m.role === 'assistant') {
              restored.push({ role: m.role, content: m.content });
            }
          }
          setMessages(restored);
          messageCountAtLoad.current = restored.length;
          setPlan(data.plan || '');
          setEditDraft(data.plan || '');
          return;
        }
      } catch {
        // Failed to load — start fresh
      }
      // No saved session — start fresh
      setSessionId(null);
      setMessages([{ role: 'system', content: SYSTEM_WELCOME }]);
      messageCountAtLoad.current = 1;
      setPlan('');
    })();
  }, [open, apiBaseUrl]);

  const isDirty = useMemo(() => messages.length > messageCountAtLoad.current || planDirty, [messages, planDirty]);
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
        body: JSON.stringify({
          sessionId,
          message: msg,
          plan: planDirty ? plan : undefined
        })
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
        // Update plan from Claude (only if not currently editing)
        if (data.plan && !isEditing) {
          setPlan(data.plan);
          setEditDraft(data.plan);
          setPlanDirty(false);
        } else if (data.plan && isEditing) {
          // Store pending plan update — will be applied when user exits edit mode
          // For now, just track that Claude sent a plan but don't override
          setPlanDirty(false);
        }
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
      setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 50);
    }
  }, [draft, sending, generating, sessionId, apiBaseUrl, showToast, plan, planDirty, isEditing]);

  const handleGenerateEpics = useCallback(async () => {
    if (!sessionId || generating || sending) return;

    setGenerating(true);
    setMessages(prev => [...prev, { role: 'system', content: 'Generating Epics from our conversation...' }]);

    try {
      const response = await fetch(`${apiBaseUrl}/api/ideas/generate-epics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, plan })
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
  }, [sessionId, generating, sending, apiBaseUrl, showToast, onCreated, onClose, onShowErrorDetail, plan]);

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
        <Modal className="sm:max-w-6xl">
          <Dialog>
            <div className="flex w-full flex-col rounded-xl border border-secondary bg-primary shadow-2xl" style={{ maxHeight: '90vh' }}>
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

              {/* Two-column body */}
              <div className="flex flex-1 flex-col sm:flex-row overflow-hidden">
                {/* Left column: Chat */}
                <div className="flex flex-1 flex-col border-b sm:border-b-0 sm:border-r border-secondary sm:w-1/2">
                  {/* Chat Messages */}
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ minHeight: '250px' }}>
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
                  <div className="border-t border-secondary px-5 py-3 space-y-2">
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
                        color="primary"
                        onPress={handleSend}
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
                    <p className="text-center text-xs text-quaternary">
                      Press Enter to send, Shift+Enter for new line
                    </p>
                  </div>
                </div>

                {/* Right column: Plan */}
                <div className="flex flex-1 flex-col sm:w-1/2">
                  {/* Plan header bar */}
                  <div className="flex items-center justify-between border-b border-secondary px-5 py-2.5">
                    <span className="text-sm font-semibold text-primary">Plan</span>
                    <button
                      onClick={() => {
                        if (isEditing) {
                          // Exiting edit mode — apply changes
                          if (editDraft !== plan) {
                            setPlan(editDraft);
                            setPlanDirty(true);
                          }
                          setIsEditing(false);
                        } else {
                          // Entering edit mode
                          setEditDraft(plan);
                          setIsEditing(true);
                        }
                      }}
                      disabled={!plan}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-secondary transition hover:bg-primary_hover hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isEditing ? (
                        <>
                          <Check className="size-3.5" />
                          <span>Done</span>
                        </>
                      ) : (
                        <>
                          <Edit05 className="size-3.5" />
                          <span>Edit</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Plan content */}
                  <div className="flex-1 overflow-y-auto px-5 py-4">
                    {!plan ? (
                      /* Empty state */
                      <div className="flex h-full items-center justify-center">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <File06 className="size-10 text-quaternary" />
                          <div>
                            <p className="text-sm font-medium text-tertiary">No plan yet</p>
                            <p className="mt-1 text-xs text-quaternary">
                              Start chatting and a plan will appear here
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : isEditing ? (
                      /* Edit mode */
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        className="h-full w-full resize-none rounded-lg border border-secondary bg-primary p-3 font-mono text-xs text-primary focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                        style={{ minHeight: '300px' }}
                      />
                    ) : (
                      /* View mode — rendered markdown */
                      <div
                        className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-primary prose-p:text-secondary prose-li:text-secondary prose-strong:text-primary prose-a:text-brand-primary [&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-utility-success-500"
                        dangerouslySetInnerHTML={{ __html: parseMarkdownSafe(plan) }}
                      />
                    )}
                  </div>

                  {/* Dirty indicator */}
                  {planDirty && !isEditing && (
                    <div className="border-t border-secondary px-5 py-2">
                      <p className="text-xs text-utility-warning-500">
                        You have manual edits. They will be sent with your next message.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Generate Epics button */}
              <div className="flex justify-end border-t border-secondary px-6 py-4">
                <Button
                  size="md"
                  color="primary"
                  iconLeading={generating ? RefreshCw01 : Lightbulb02}
                  onPress={handleGenerateEpics}
                  isDisabled={!plan.trim() || sending || generating}
                  isLoading={generating}
                  showTextWhileLoading
                >
                  {generating ? 'Generating Epics...' : 'Generate Epics from Plan'}
                </Button>
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

// ── Helpers ──────────────────────────────────────────────────────────

function parseMarkdownSafe(content: string): string {
  try {
    const result = marked.parse(content, { gfm: true, breaks: true });
    return typeof result === 'string' ? result : content;
  } catch {
    return content;
  }
}

function MessageBubble({ message }: { message: ChatMessage }): React.JSX.Element {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="max-w-md rounded-lg bg-tertiary px-4 py-3 text-left text-sm text-secondary">
          <div
            className="[&_p]:my-1 [&_ul]:my-1 [&_li]:my-0 [&_ul]:list-disc [&_ul]:pl-4"
            dangerouslySetInnerHTML={{ __html: parseMarkdownSafe(message.content) }}
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
          className="[&_p]:my-1 [&_ul]:my-1 [&_li]:my-0 [&_ul]:list-disc [&_ul]:pl-4 [&_strong]:font-semibold [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold"
          dangerouslySetInnerHTML={{ __html: parseMarkdownSafe(message.content) }}
        />
      </div>
    </div>
  );
}
