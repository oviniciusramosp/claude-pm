// panel/src/components/idea-to-epics-modal.tsx

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbulb02, Send01, RefreshCw01, X, Edit05, Check, File06, ChevronRight, User01, Asterisk02, ClockRewind } from '@untitledui/icons';
import { marked } from 'marked';
import { Button } from '@/components/base/buttons/button';
import { Dialog, Modal, ModalOverlay } from '@/components/application/modals/modal';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { SourceAvatar } from './source-avatar';
import { Icon } from './icon';
import type { LogSourceMeta } from '../types';

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

interface ArchivedSession {
  fileName: string;
  sessionId: string;
  createdAt: number;
  archivedAt: number | null;
  epicNames: string[];
  messageCount: number;
  planPreview: string;
  hasPlan: boolean;
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
  const [generateStatus, setGenerateStatus] = useState<{
    phase: string | null;
    created: number;
    total: number;
    failed: number;
    canResume: boolean;
  } | null>(null);
  const generatePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Plan state
  const [plan, setPlan] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [planDirty, setPlanDirty] = useState(false);
  const [planUpdatedAt, setPlanUpdatedAt] = useState<Date | null>(null);
  const [syncingToPlan, setSyncingToPlan] = useState(false);

  // Session history state
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSession[]>([]);
  const [showArchives, setShowArchives] = useState(false);
  const [loadingArchive, setLoadingArchive] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Poll generation status until completion
  const startPollingEpics = useCallback(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/ideas/generate-epics/status`);
        const status = await res.json().catch(() => ({}));
        setGenerateStatus({
          phase: status.phase || null,
          created: status.created || 0,
          total: status.total || 0,
          failed: status.failed || 0,
          canResume: status.canResume || false
        });

        if (status.running) {
          generatePollRef.current = setTimeout(poll, 1500);
        } else {
          setGenerating(false);
          const failed = status.failed || 0;
          const created = status.created || 0;
          const total = status.total || 0;
          if (failed > 0) {
            showToast(`Generated ${created} of ${total} Epics (${failed} failed). Click "Generate Epics" to resume.`, 'warning');
          } else if (created > 0) {
            showToast(`Generated ${created} Epics successfully.`, 'success');
            onCreated();
            onClose();
          } else {
            showToast('Epic generation finished with no Epics created.', 'danger');
          }
        }
      } catch {
        setGenerating(false);
        setGenerateStatus(null);
      }
    };
    poll();
  }, [apiBaseUrl, showToast, onCreated, onClose]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (generatePollRef.current) clearTimeout(generatePollRef.current);
    };
  }, []);

  // On modal open: check if a generation is already running and resume polling
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/ideas/generate-epics/status`);
        const status = await res.json().catch(() => ({}));
        if (!cancelled && status.running) {
          setGenerating(true);
          setGenerateStatus({
            phase: status.phase || null,
            created: status.created || 0,
            total: status.total || 0,
            failed: status.failed || 0,
            canResume: false
          });
          startPollingEpics();
        } else if (!cancelled && status.canResume) {
          setGenerateStatus({
            phase: null,
            created: status.created || 0,
            total: status.total || 0,
            failed: status.failed || 0,
            canResume: true
          });
        }
      } catch {
        // ignore — server may not be reachable yet
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    setPlanUpdatedAt(null);
    setSyncingToPlan(false);
    setSending(false);
    setGenerating(false);
    setShowArchives(false);
    setLoadingArchive(false);

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
          setPlan(data.plan || '');
          setEditDraft(data.plan || '');
          if (data.plan) setPlanUpdatedAt(new Date());
        } else {
          // No saved session — start fresh
          setSessionId(null);
          setMessages([{ role: 'system', content: SYSTEM_WELCOME }]);
          setPlan('');
        }
      } catch {
        // Failed to load — start fresh
        setSessionId(null);
        setMessages([{ role: 'system', content: SYSTEM_WELCOME }]);
        setPlan('');
      }

      // Fetch archived sessions for history picker
      try {
        const archiveRes = await fetch(`${apiBaseUrl}/api/ideas/sessions/archived`);
        const archiveData = await archiveRes.json();
        if (archiveData.ok) {
          setArchivedSessions(archiveData.sessions || []);
        }
      } catch { /* non-fatal */ }
    })();
  }, [open, apiBaseUrl]);

  const hasConversation = messages.some(m => m.role === 'assistant');

  const handleCloseAttempt = useCallback(() => {
    if (sending || generating) return; // Block close while in-flight
    onClose();
  }, [sending, generating, onClose]);

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

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        showToast(`Server returned unexpected response (${response.status}). Please try again.`, 'danger');
        setMessages(prev => prev.slice(0, -1));
        setDraft(msg);
        return;
      }

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
          setPlanUpdatedAt(new Date());
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
    setGenerateStatus({ phase: 'planning', created: 0, total: 0, failed: 0, canResume: false });

    try {
      const response = await fetch(`${apiBaseUrl}/api/ideas/generate-epics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, plan })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errMsg = data?.message || `Request failed (${response.status})`;
        if (onShowErrorDetail) {
          onShowErrorDetail('Epic generation failed', errMsg);
        }
        showToast('Failed to start Epic generation', 'danger');
        setGenerating(false);
        setGenerateStatus(null);
        return;
      }

      // Backend responds immediately; poll status until done
      startPollingEpics();
    } catch (error: any) {
      showToast(`Network error: ${error.message}`, 'danger');
      setGenerating(false);
      setGenerateStatus(null);
    }
  }, [sessionId, generating, sending, apiBaseUrl, showToast, onShowErrorDetail, plan, startPollingEpics]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // "To Plan" — ask Claude to update the plan based on the conversation so far
  const handleSyncToPlan = useCallback(async () => {
    if (!sessionId || sending || generating || syncingToPlan) return;

    setSyncingToPlan(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/ideas/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: '[System] Please update the plan document to reflect everything we have discussed so far. Make sure the plan is comprehensive and up to date. Do not ask questions — just update the plan.',
          plan: planDirty ? plan : undefined
        })
      });

      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        showToast(`Server returned unexpected response (${response.status}). Please try again.`, 'danger');
        return;
      }

      const data = await response.json();

      if (response.ok && data.ok) {
        setSessionId(data.sessionId);
        // We don't add the system message to the visible chat — just update the plan silently
        if (data.plan) {
          setPlan(data.plan);
          setEditDraft(data.plan);
          setPlanDirty(false);
          setPlanUpdatedAt(new Date());
        }
        showToast('Plan updated', 'success');
      } else {
        showToast(data?.message || 'Failed to sync plan', 'danger');
      }
    } catch (error: any) {
      showToast(`Network error: ${error.message}`, 'danger');
    } finally {
      setSyncingToPlan(false);
    }
  }, [sessionId, sending, generating, syncingToPlan, apiBaseUrl, plan, planDirty, showToast]);

  // Load an archived session
  const handleLoadArchive = useCallback(async (fileName: string) => {
    if (loadingArchive || sending || generating) return;
    setLoadingArchive(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/ideas/sessions/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName })
      });
      const data = await response.json();

      if (data.ok) {
        setSessionId(data.sessionId);
        const restored: ChatMessage[] = [{ role: 'system', content: SYSTEM_WELCOME }];
        for (const m of (data.messages || [])) {
          if (m.role === 'user' || m.role === 'assistant') {
            restored.push({ role: m.role, content: m.content });
          }
        }
        setMessages(restored);
        setPlan(data.plan || '');
        setEditDraft(data.plan || '');
        if (data.plan) setPlanUpdatedAt(new Date());
        setPlanDirty(false);
        setShowArchives(false);
        showToast('Session restored', 'success');
      } else {
        showToast(data.message || 'Failed to load session', 'danger');
      }
    } catch (error: any) {
      showToast(`Network error: ${error.message}`, 'danger');
    } finally {
      setLoadingArchive(false);
    }
  }, [loadingArchive, sending, generating, apiBaseUrl, showToast]);

  // Auto-resize textarea
  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  return (
      <ModalOverlay isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleCloseAttempt(); }} isDismissable={!sending && !generating}>
        <Modal className="sm:max-w-6xl">
          <Dialog>
            <div className="flex w-full flex-col rounded-xl border border-secondary bg-primary shadow-2xl" style={{ maxHeight: '90vh' }}>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-secondary px-6 py-4">
                <div className="flex items-center gap-2">
                  <Icon icon={Lightbulb02} className="size-5 text-warning" />
                  <h3 className="text-lg font-semibold text-primary">Idea to Epics</h3>
                  {archivedSessions.length > 0 && (
                    <button
                      onClick={() => setShowArchives(!showArchives)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-tertiary transition hover:bg-primary_hover hover:text-secondary"
                    >
                      <ClockRewind className="size-3.5" />
                      <span>History ({archivedSessions.length})</span>
                    </button>
                  )}
                </div>
                <button
                  onClick={handleCloseAttempt}
                  className="rounded-sm p-1 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Session history panel (collapsible) */}
              {showArchives && (
                <div className="border-b border-secondary bg-secondary px-6 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-primary">Session History</span>
                    <button
                      onClick={() => setShowArchives(false)}
                      className="rounded-sm p-1 text-tertiary transition hover:text-secondary"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {archivedSessions.map((session: ArchivedSession) => (
                      <button
                        key={session.fileName}
                        onClick={() => handleLoadArchive(session.fileName)}
                        disabled={loadingArchive}
                        className="w-full rounded-lg border border-secondary bg-primary p-3 text-left transition hover:bg-primary_hover disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-primary">
                            {session.epicNames.length > 0
                              ? session.epicNames.slice(0, 2).join(', ') + (session.epicNames.length > 2 ? ` +${session.epicNames.length - 2}` : '')
                              : 'Untitled session'}
                          </span>
                          <span className="text-xs text-quaternary">
                            {new Date(session.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-tertiary">
                          <span>{session.messageCount} msgs</span>
                          {session.hasPlan && <span className="text-utility-success-500">Has plan</span>}
                          {session.epicNames.length > 0 && (
                            <span>{session.epicNames.length} epic{session.epicNames.length !== 1 ? 's' : ''} generated</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Two-column body */}
              <div className="relative flex flex-1 flex-col sm:flex-row overflow-hidden">
                {/* "To Plan" button on the column divider */}
                <div className="hidden sm:flex absolute left-1/2 top-3 z-10 -translate-x-1/2">
                  <Tooltip title="To Plan" placement="right">
                    <TooltipTrigger
                      onPress={handleSyncToPlan}
                      isDisabled={!hasConversation || sending || generating || syncingToPlan}
                      className="flex items-center justify-center rounded-full border border-secondary bg-primary p-1.5 shadow-sm transition hover:bg-primary_hover disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {syncingToPlan ? (
                        <RefreshCw01 className="size-3.5 animate-spin text-tertiary" />
                      ) : (
                        <ChevronRight className="size-3.5 text-tertiary" />
                      )}
                    </TooltipTrigger>
                  </Tooltip>
                </div>

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
                  <div className="border-t border-secondary px-4 py-3">
                    <div
                      className="flex items-end gap-2 bg-primary p-2 shadow-xs ring-1 ring-primary ring-inset transition-shadow duration-100 ease-linear has-[:focus]:ring-2 has-[:focus]:ring-brand"
                      style={{ borderRadius: 'var(--board-col-radius)', ['--inner-radius' as any]: 'calc(var(--board-col-radius) - 0.5rem)' }}
                    >
                      <Tooltip title="Press Enter to send, Shift+Enter for new line" delay={600}>
                        <TooltipTrigger className="min-w-0 flex-1">
                          <textarea
                            ref={textareaRef}
                            value={draft}
                            onChange={handleTextareaInput}
                            onKeyDown={handleKeyDown}
                            placeholder={hasConversation ? 'Type your response...' : 'Describe your product ideas...'}
                            className="min-w-0 w-full resize-none bg-transparent py-1 pl-2 text-sm text-primary outline-hidden placeholder:text-placeholder"
                            rows={2}
                            style={{ minHeight: '44px', maxHeight: '200px' }}
                            disabled={sending || generating}
                          />
                        </TooltipTrigger>
                      </Tooltip>
                      <Button
                        size="sm"
                        color="primary"
                        iconLeading={Send01}
                        className="shrink-0 size-9! rounded-[var(--inner-radius)]! [&_svg]:!size-4"
                        onPress={handleSend}
                        isDisabled={!draft.trim() || sending || generating}
                        aria-label="Send message"
                      />
                    </div>
                  </div>
                </div>

                {/* Right column: Plan */}
                <div className="flex flex-1 flex-col sm:w-1/2">
                  {/* Plan header bar */}
                  <div className="flex items-center justify-between border-b border-secondary px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-primary">Plan</span>
                      {planUpdatedAt && (
                        <span className="text-[10px] text-quaternary tabular-nums">
                          {planUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      )}
                    </div>
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

              {/* Generate Epics button + progress */}
              <div className="flex items-center justify-between border-t border-secondary px-6 py-4">
                {/* Progress indicator */}
                <div className="flex-1 mr-4">
                  {generating && generateStatus && (
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs font-medium text-secondary">
                        {generateStatus.phase === 'planning'
                          ? 'Planning Epics...'
                          : generateStatus.total > 0
                            ? `Generating ${generateStatus.created} of ${generateStatus.total} Epics${generateStatus.failed > 0 ? ` (${generateStatus.failed} failed)` : ''}...`
                            : 'Generating Epics...'}
                      </p>
                      {generateStatus.phase === 'generating' && generateStatus.total > 0 && (
                        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand-600 transition-all duration-500"
                            style={{ width: `${Math.round((generateStatus.created / generateStatus.total) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {!generating && generateStatus?.canResume && (
                    <p className="text-xs text-utility-warning-500">
                      Generation partially failed ({generateStatus.failed} of {generateStatus.total} Epics). Click to resume.
                    </p>
                  )}
                </div>
                <Button
                  size="md"
                  color="primary"
                  iconLeading={generating ? RefreshCw01 : Lightbulb02}
                  onPress={handleGenerateEpics}
                  isDisabled={!plan.trim() || sending || generating}
                  isLoading={generating}
                  showTextWhileLoading
                >
                  {generating
                    ? 'Generating...'
                    : generateStatus?.canResume
                      ? 'Resume Generation'
                      : 'Generate Epics from Plan'}
                </Button>
              </div>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
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

const USER_AVATAR_META: LogSourceMeta = {
  label: 'You',
  icon: User01,
  side: 'outgoing',
  avatarInitials: 'YO',
  directClaude: false
};

const ASSISTANT_AVATAR_META: LogSourceMeta = {
  label: 'Claude',
  icon: Asterisk02,
  side: 'incoming',
  avatarInitials: 'CL',
  avatarColor: '#d97757',
  directClaude: true
};

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
      <div className="flex items-end justify-end gap-2">
        <div className="max-w-[75%] rounded-lg rounded-br-sm bg-brand-600 px-4 py-3 text-sm text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        <SourceAvatar sourceMeta={USER_AVATAR_META} />
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex items-end justify-start gap-2">
      <SourceAvatar sourceMeta={ASSISTANT_AVATAR_META} />
      <div className="max-w-[75%] rounded-lg rounded-bl-sm bg-secondary px-4 py-3 text-sm text-primary">
        <div
          className="[&_p]:my-1 [&_ul]:my-1 [&_li]:my-0 [&_ul]:list-disc [&_ul]:pl-4 [&_strong]:font-semibold [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold"
          dangerouslySetInnerHTML={{ __html: parseMarkdownSafe(message.content) }}
        />
      </div>
    </div>
  );
}
