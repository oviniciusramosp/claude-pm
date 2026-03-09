// panel/src/components/knowledge-base-tab.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Edit05,
  File06,
  Folder,
  Globe01,
  Lightbulb02,
  RefreshCw01,
  Save01,
  Server01,
  Stars01,
  TerminalBrowser,
  X,
  CornerUpLeft
} from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Badge } from '@/components/base/badges/badges';
import { cx } from '@/utils/cx';
import { Icon } from './icon';
import { SetupRequiredBanner } from './setup-required-banner';

interface KnowledgeBaseTabProps {
  apiBaseUrl: string;
  showToast: (message: string, color?: 'success' | 'warning' | 'danger' | 'neutral') => void;
  setupComplete: boolean;
  onNavigateToSetup: () => void;
}

interface KBFile {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

interface KBGroup {
  id: string;
  label: string;
  description: string;
  icon: string;
  basePath: string;
  files: KBFile[];
}

interface MCPServer {
  name: string;
  scope: 'user' | 'project';
  type: string;
  command: string | null;
  args: string[];
  url: string | null;
  env: string[];
}

const GROUP_ICONS: Record<string, typeof Lightbulb02> = {
  file: File06,
  terminal: TerminalBrowser
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(diffDay > 365 ? { year: 'numeric' } : {})
  });
}

function SkeletonRow() {
  return (
    <div className="animate-pulse rounded-lg border border-secondary bg-primary p-3">
      <div className="h-4 w-3/4 rounded bg-quaternary" />
      <div className="mt-2 flex gap-3">
        <div className="h-3 w-20 rounded bg-quaternary" />
        <div className="h-3 w-16 rounded bg-quaternary" />
      </div>
    </div>
  );
}

const MCP_TYPE_COLORS: Record<string, string> = {
  stdio: 'gray',
  sse: 'blue',
  http: 'indigo',
  ws: 'violet'
};

export function KnowledgeBaseTab({ apiBaseUrl, showToast, setupComplete, onNavigateToSetup }: KnowledgeBaseTabProps) {
  const [groups, setGroups] = useState<KBGroup[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<KBFile | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewInstruction, setReviewInstruction] = useState('');
  const [showReviewInput, setShowReviewInput] = useState(false);
  const [preReviewContent, setPreReviewContent] = useState<string | null>(null);
  const [mcpExpanded, setMcpExpanded] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const reviewAbortRef = useRef<AbortController | null>(null);

  // Fetch tree
  const fetchTree = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/knowledge-base/tree`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      if (!mountedRef.current) return;
      const payload = await response.json();
      if (payload.ok) {
        setGroups(payload.groups || []);
        setMcpServers(payload.mcpServers || []);
        // Auto-expand all groups on first load
        if (expandedGroups.size === 0 && payload.groups?.length > 0) {
          setExpandedGroups(new Set(payload.groups.map((g: KBGroup) => g.id)));
        }
      }
    } catch {
      if (!mountedRef.current) return;
      showToast('Failed to load knowledge base.', 'danger');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [apiBaseUrl, showToast, expandedGroups.size]);

  useEffect(() => {
    mountedRef.current = true;
    fetchTree();
    return () => { mountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl]);

  // Open file
  const openFile = useCallback(async (file: KBFile) => {
    setLoadingFile(true);
    setEditing(false);
    setShowReviewInput(false);
    setPreReviewContent(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/knowledge-base/file?path=${encodeURIComponent(file.path)}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const payload = await response.json();
      if (payload.ok) {
        setSelectedFile(file);
        setFileContent(payload.content);
        setOriginalContent(payload.content);
      } else {
        showToast(payload.message || 'Failed to read file.', 'danger');
      }
    } catch {
      showToast('Failed to read file.', 'danger');
    } finally {
      setLoadingFile(false);
    }
  }, [apiBaseUrl, showToast]);

  // Save file
  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/knowledge-base/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ path: selectedFile.path, content: fileContent })
      });
      const payload = await response.json();
      if (payload.ok) {
        setOriginalContent(fileContent);
        setEditing(false);
        setPreReviewContent(null);
        showToast('File saved successfully.');
        fetchTree(true);
      } else {
        showToast(payload.message || 'Failed to save file.', 'danger');
      }
    } catch {
      showToast('Failed to save file.', 'danger');
    } finally {
      setSaving(false);
    }
  }, [apiBaseUrl, selectedFile, fileContent, showToast, fetchTree]);

  // AI Review
  const reviewFile = useCallback(async () => {
    if (!selectedFile) return;
    setReviewing(true);
    setPreReviewContent(fileContent);

    const abortController = new AbortController();
    reviewAbortRef.current = abortController;

    try {
      const response = await fetch(`${apiBaseUrl}/api/knowledge-base/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          filePath: selectedFile.path,
          content: fileContent,
          instruction: reviewInstruction.trim() || undefined
        }),
        signal: abortController.signal
      });
      const payload = await response.json();
      if (payload.ok && payload.improvedContent) {
        setFileContent(payload.improvedContent);
        setEditing(true);
        setShowReviewInput(false);
        setReviewInstruction('');
        showToast('Review completed. Check changes and save.');
      } else {
        showToast(payload.message || 'Review failed.', 'danger');
        setPreReviewContent(null);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        showToast('Review cancelled.', 'neutral');
      } else {
        showToast('Review failed.', 'danger');
      }
      setPreReviewContent(null);
    } finally {
      setReviewing(false);
      reviewAbortRef.current = null;
    }
  }, [apiBaseUrl, selectedFile, fileContent, reviewInstruction, showToast]);

  // Undo review
  const undoReview = useCallback(() => {
    if (preReviewContent !== null) {
      setFileContent(preReviewContent);
      setPreReviewContent(null);
      showToast('Review changes reverted.', 'neutral');
    }
  }, [preReviewContent, showToast]);

  // Toggle group expand
  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const hasChanges = fileContent !== originalContent;
  const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
      {!setupComplete && <SetupRequiredBanner onNavigateToSetup={onNavigateToSetup} />}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon icon={Lightbulb02} className="size-5 shrink-0 text-tertiary" />
          <h2 className="truncate text-2xl font-bold text-primary tracking-tight">Knowledge</h2>
        </div>
        {!loading && (
          <div className="flex items-center gap-2">
            {totalFiles > 0 && (
              <Badge size="sm" color="gray">{totalFiles} {totalFiles === 1 ? 'file' : 'files'}</Badge>
            )}
            {mcpServers.length > 0 && (
              <Badge size="sm" color="brand">{mcpServers.length} MCP {mcpServers.length === 1 ? 'server' : 'servers'}</Badge>
            )}
          </div>
        )}
        <div className="ml-auto">
          <Button
            size="sm"
            color="tertiary"
            iconLeading={RefreshCw01}
            isLoading={refreshing}
            onPress={() => fetchTree()}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Main layout: sidebar + content */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Sidebar: file tree + MCP servers */}
        <div className="flex w-72 shrink-0 flex-col overflow-y-auto rounded-xl border border-secondary bg-primary">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : (groups.length === 0 && mcpServers.length === 0) ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <Icon icon={Lightbulb02} className="mb-3 size-8 text-quaternary" />
              <p className="text-sm font-medium text-secondary">No knowledge files</p>
              <p className="mt-1 text-xs text-quaternary">
                CLAUDE.md and slash commands will appear here.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {/* File groups */}
              {groups.map((group) => {
                const isExpanded = expandedGroups.has(group.id);
                const GroupIcon = GROUP_ICONS[group.icon] || Folder;

                return (
                  <div key={group.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-primary_hover transition"
                      onClick={() => toggleGroup(group.id)}
                    >
                      <Icon
                        icon={isExpanded ? ChevronDown : ChevronRight}
                        className="size-3.5 shrink-0 text-quaternary"
                      />
                      <Icon icon={GroupIcon} className="size-4 shrink-0 text-tertiary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-primary">{group.label}</p>
                        <p className="truncate text-[10px] text-quaternary">{group.description}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-quaternary/20 px-1.5 py-0.5 text-[10px] font-medium text-quaternary">
                        {group.files.length}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="pb-1">
                        {group.files.map((file) => {
                          const isActive = selectedFile?.path === file.path;
                          return (
                            <button
                              key={file.path}
                              type="button"
                              className={cx(
                                'flex w-full items-center gap-2 px-3 py-1.5 pl-9 text-left transition',
                                isActive
                                  ? 'bg-brand-secondary text-brand-primary'
                                  : 'hover:bg-primary_hover text-secondary'
                              )}
                              onClick={() => openFile(file)}
                            >
                              <Icon icon={File06} className="size-3.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">{file.relativePath}</p>
                                <p className="text-[10px] text-quaternary">
                                  {formatFileSize(file.size)} · {formatRelativeDate(file.modifiedAt)}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* MCP Servers section */}
              {mcpServers.length > 0 && (
                <>
                  {groups.length > 0 && <div className="mx-3 my-1 border-t border-secondary" />}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-primary_hover transition"
                    onClick={() => setMcpExpanded((prev) => !prev)}
                  >
                    <Icon
                      icon={mcpExpanded ? ChevronDown : ChevronRight}
                      className="size-3.5 shrink-0 text-quaternary"
                    />
                    <Icon icon={Server01} className="size-4 shrink-0 text-tertiary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-primary">MCP Servers</p>
                      <p className="truncate text-[10px] text-quaternary">Connected tools</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-quaternary/20 px-1.5 py-0.5 text-[10px] font-medium text-quaternary">
                      {mcpServers.length}
                    </span>
                  </button>

                  {mcpExpanded && (
                    <div className="pb-1">
                      {mcpServers.map((server) => (
                        <div
                          key={server.name}
                          className="flex items-start gap-2 px-3 py-1.5 pl-9"
                        >
                          <Icon
                            icon={server.type === 'stdio' ? TerminalBrowser : Globe01}
                            className="mt-0.5 size-3.5 shrink-0 text-quaternary"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-xs font-medium text-primary">{server.name}</p>
                              <Badge size="sm" color={(MCP_TYPE_COLORS[server.type] || 'gray') as any}>
                                {server.type}
                              </Badge>
                            </div>
                            <p className="truncate text-[10px] text-quaternary">
                              {server.url || [server.command, ...(server.args || [])].filter(Boolean).join(' ')}
                            </p>
                            {server.scope === 'project' && (
                              <Badge size="sm" color="indigo" className="mt-0.5">project</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* File content area */}
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-secondary bg-primary">
          {loadingFile ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-sm text-tertiary">Loading file...</div>
            </div>
          ) : !selectedFile ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <Icon icon={File06} className="mb-3 size-10 text-quaternary" />
              <p className="text-sm font-medium text-secondary">Select a file to view</p>
              <p className="mt-1 text-xs text-quaternary">
                Choose a file from the sidebar to view or edit its contents.
              </p>
            </div>
          ) : (
            <>
              {/* File header toolbar */}
              <div className="flex shrink-0 items-center gap-2 border-b border-secondary px-4 py-2.5">
                <Icon icon={File06} className="size-4 shrink-0 text-tertiary" />
                <span className="truncate text-sm font-medium text-primary">{selectedFile.name}</span>
                {hasChanges && (
                  <span className="shrink-0 rounded-full bg-warning-secondary px-2 py-0.5 text-[10px] font-semibold text-warning-primary">
                    Unsaved
                  </span>
                )}

                <div className="ml-auto flex items-center gap-1.5">
                  {preReviewContent !== null && !reviewing && (
                    <Button size="sm" color="tertiary" iconLeading={CornerUpLeft} onPress={undoReview}>
                      Undo Review
                    </Button>
                  )}

                  {editing && (
                    <Button
                      size="sm"
                      color="tertiary"
                      iconLeading={Stars01}
                      isLoading={reviewing}
                      onPress={() => {
                        if (showReviewInput) {
                          reviewFile();
                        } else {
                          setShowReviewInput(true);
                        }
                      }}
                    >
                      {reviewing ? 'Reviewing...' : 'Review with Claude'}
                    </Button>
                  )}

                  {!editing ? (
                    <Button size="sm" color="tertiary" iconLeading={Edit05} onPress={() => setEditing(true)}>
                      Edit
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      color="tertiary"
                      iconLeading={X}
                      onPress={() => {
                        if (reviewing && reviewAbortRef.current) {
                          reviewAbortRef.current.abort();
                        }
                        setEditing(false);
                        setFileContent(originalContent);
                        setPreReviewContent(null);
                        setShowReviewInput(false);
                        setReviewInstruction('');
                      }}
                    >
                      Cancel
                    </Button>
                  )}

                  {editing && hasChanges && (
                    <Button size="sm" color="primary" iconLeading={Save01} isLoading={saving} onPress={saveFile}>
                      Save
                    </Button>
                  )}
                </div>
              </div>

              {/* Review instruction input */}
              {showReviewInput && editing && (
                <div className="flex shrink-0 items-center gap-2 border-b border-secondary bg-secondary/30 px-4 py-2">
                  <input
                    type="text"
                    className="flex-1 rounded-lg border border-secondary bg-primary px-3 py-1.5 text-sm text-primary placeholder:text-quaternary focus:border-brand-solid focus:outline-none"
                    placeholder="Optional: describe what to improve (e.g., 'add more detail to the logging section')"
                    value={reviewInstruction}
                    onChange={(e) => setReviewInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !reviewing) {
                        e.preventDefault();
                        reviewFile();
                      }
                      if (e.key === 'Escape') {
                        setShowReviewInput(false);
                        setReviewInstruction('');
                      }
                    }}
                    disabled={reviewing}
                    autoFocus
                  />
                  <Button size="sm" color="primary" isLoading={reviewing} onPress={reviewFile}>
                    Go
                  </Button>
                  <Button
                    size="sm"
                    color="tertiary"
                    onPress={() => {
                      setShowReviewInput(false);
                      setReviewInstruction('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {/* File content: view or edit */}
              <div className="flex-1 overflow-y-auto">
                {editing ? (
                  <textarea
                    ref={textareaRef}
                    className="h-full w-full resize-none border-none bg-transparent p-4 font-mono text-xs leading-relaxed text-primary outline-none"
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    spellCheck={false}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-primary">
                    {fileContent}
                  </pre>
                )}
              </div>

              {/* File footer */}
              <div className="flex shrink-0 items-center gap-3 border-t border-secondary px-4 py-2 text-[10px] text-quaternary">
                <span>{formatFileSize(selectedFile.size)}</span>
                <span>·</span>
                <span>Modified {formatRelativeDate(selectedFile.modifiedAt)}</span>
                <span>·</span>
                <span className="truncate">{selectedFile.path}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
