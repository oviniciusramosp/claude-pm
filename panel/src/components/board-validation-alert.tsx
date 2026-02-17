// panel/src/components/board-validation-alert.tsx

import { AlertCircle, CheckCircle, AlertTriangle, FolderPlus, XCircle } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Icon } from './icon';
import { cx } from '@/utils/cx';
import { useEffect, useState } from 'react';

interface BoardValidationError {
  type: string;
  message: string;
  severity?: string;
  suggestion?: string;
  path?: string;
}

interface BoardValidationWarning {
  type: string;
  message: string;
  severity?: string;
  suggestion?: string;
  path?: string;
}

interface BoardValidationResult {
  valid: boolean;
  errors: BoardValidationError[];
  warnings: BoardValidationWarning[];
  info: {
    totalTasks: number;
    totalEpics: number;
    tasksWithoutStatus: number;
    tasksWithInvalidStatus: number;
  };
}

export function BoardValidationAlert({
  apiBaseUrl
}: {
  apiBaseUrl: string;
}) {
  const [validation, setValidation] = useState<BoardValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [boardExists, setBoardExists] = useState<boolean | null>(null);
  const [boardDir, setBoardDir] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    checkBoardAndValidate();
  }, [apiBaseUrl]);

  async function checkBoardExists(): Promise<boolean> {
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/exists`);
      if (!response.ok) return true; // assume exists on error, fall through to validation
      const data = await response.json();
      setBoardDir(data.boardDir || null);
      setBoardExists(data.exists);
      return data.exists;
    } catch {
      return true; // assume exists on error
    }
  }

  async function checkBoardAndValidate() {
    setLoading(true);
    setError(null);

    const exists = await checkBoardExists();
    if (!exists) {
      setLoading(false);
      return;
    }

    await fetchValidation();
  }

  async function createBoardDirectory() {
    setCreating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/board/create-directory`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to create Board directory');
      }
      setBoardExists(true);
      await fetchValidation();
    } catch (err: any) {
      setError(err.message || 'Failed to create Board directory');
    } finally {
      setCreating(false);
    }
  }

  async function fetchValidation() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/validate-board`);
      if (!response.ok) {
        // Try to parse JSON error response
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // If JSON parsing fails, use the status text
        }

        // Provide more context for common errors
        if (response.status === 404) {
          throw new Error(
            `API endpoint not found. The automation API may not be running or is using a different version. Try restarting the API.`
          );
        } else if (response.status === 500) {
          throw new Error(
            `Server error: ${errorMessage}. Check the API logs for more details.`
          );
        } else if (response.status >= 500) {
          throw new Error(
            `Server error (${response.status}). The automation API may be experiencing issues. Check the API logs.`
          );
        } else {
          throw new Error(errorMessage);
        }
      }

      const data = await response.json();
      setValidation(data);
    } catch (err: any) {
      // Network errors or fetch failures
      if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
        setError(
          'Cannot connect to the automation API. Make sure the API is running and accessible.'
        );
      } else {
        setError(err.message || 'Failed to validate board structure');
      }
      setValidation(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-secondary bg-secondary p-4">
        <div className="flex items-center gap-3">
          <div className="size-5 animate-spin rounded-full border-2 border-secondary border-t-brand-primary" />
          <span className="text-sm text-secondary">Validating Board structure...</span>
        </div>
      </div>
    );
  }

  // Board directory does not exist — show "Create Board" prompt
  if (boardExists === false) {
    return (
      <div className="rounded-lg border border-warning-200 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-950/30">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Icon icon={AlertTriangle} className="size-5 shrink-0 text-warning-600 dark:text-warning-400" />
            <div className="flex-1 space-y-1">
              <p className="m-0 text-sm font-medium text-warning-900 dark:text-warning-100">
                Board directory not found
              </p>
              <p className="m-0 text-sm text-warning-700 dark:text-warning-300">
                The target directory does not have a <code className="rounded bg-warning-100 px-1 py-0.5 text-xs dark:bg-warning-900/30">Board/</code> folder yet. Create it to start adding tasks.
              </p>
              {boardDir && (
                <p className="m-0 text-xs text-warning-600 dark:text-warning-400 font-mono truncate" title={boardDir}>
                  {boardDir}
                </p>
              )}
            </div>
          </div>
          <div className="border-t border-warning-200/50 pt-3 dark:border-warning-500/20">
            <Button
              size="sm"
              color="primary"
              iconLeading={FolderPlus}
              isLoading={creating}
              onPress={createBoardDirectory}
            >
              Create Board Folder
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-error-200 bg-error-50 p-4 dark:border-error-500/30 dark:bg-error-950/30">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Icon icon={XCircle} className="size-5 shrink-0 text-error-600 dark:text-error-400" />
            <div className="flex-1 space-y-1">
              <p className="m-0 text-sm font-medium text-error-900 dark:text-error-100">
                Board Validation Unavailable
              </p>
              <p className="m-0 text-sm text-error-700 dark:text-error-300">{error}</p>
            </div>
          </div>
          <div className="flex gap-2 border-t border-error-200/50 pt-3 dark:border-error-500/20">
            <button
              onClick={checkBoardAndValidate}
              className="rounded-md border border-error-300 bg-white px-3 py-1.5 text-xs font-medium text-error-900 hover:bg-error-50 dark:border-error-600 dark:bg-error-950 dark:text-error-100 dark:hover:bg-error-900/50"
            >
              Retry
            </button>
            <a
              href="#feed"
              className="rounded-md border border-error-300 bg-white px-3 py-1.5 text-xs font-medium text-error-900 hover:bg-error-50 dark:border-error-600 dark:bg-error-950 dark:text-error-100 dark:hover:bg-error-900/50"
            >
              View API Logs
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!validation) {
    return null;
  }

  const { valid, errors, warnings, info } = validation;

  // Critical errors (Board not found, etc.)
  const criticalErrors = errors.filter(e => e.severity === 'critical');
  const highErrors = errors.filter(e => e.severity === 'high');
  const otherErrors = errors.filter(e => !e.severity || (e.severity !== 'critical' && e.severity !== 'high'));

  const highWarnings = warnings.filter(w => w.severity === 'high');
  const otherWarnings = warnings.filter(w => w.severity !== 'high');

  if (valid && warnings.length === 0) {
    return (
      <div className="rounded-lg border border-success-200 bg-success-50 p-4 dark:border-success-500/30 dark:bg-success-950/30">
        <div className="flex items-start gap-3">
          <Icon icon={CheckCircle} className="size-5 shrink-0 text-success-600 dark:text-success-400" />
          <div className="flex-1 space-y-1">
            <p className="m-0 text-sm font-medium text-success-900 dark:text-success-100">
              Board structure is valid
            </p>
            <p className="m-0 text-xs text-success-700 dark:text-success-300">
              {info.totalTasks} tasks, {info.totalEpics} epics
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        'rounded-lg border p-4',
        valid
          ? 'border-warning-200 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-950/30'
          : 'border-error-200 bg-error-50 dark:border-error-500/30 dark:bg-error-950/30'
      )}
    >
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Icon
            icon={valid ? AlertTriangle : AlertCircle}
            className={cx(
              'size-5 shrink-0',
              valid
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-error-600 dark:text-error-400'
            )}
          />
          <div className="flex-1 space-y-1">
            <p
              className={cx(
                'm-0 text-sm font-medium',
                valid
                  ? 'text-warning-900 dark:text-warning-100'
                  : 'text-error-900 dark:text-error-100'
              )}
            >
              {valid ? 'Board structure has warnings' : 'Board structure has errors'}
            </p>
            <p
              className={cx(
                'm-0 text-xs',
                valid
                  ? 'text-warning-700 dark:text-warning-300'
                  : 'text-error-700 dark:text-error-300'
              )}
            >
              {errors.length > 0 && `${errors.length} error${errors.length > 1 ? 's' : ''}`}
              {errors.length > 0 && warnings.length > 0 && ', '}
              {warnings.length > 0 && `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 rounded px-2 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            {expanded ? 'Hide' : 'Show'} Details
          </button>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="space-y-3 border-t border-current/10 pt-3">
            {/* Critical errors */}
            {criticalErrors.length > 0 && (
              <div className="space-y-2">
                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-error-900 dark:text-error-100">
                  Critical Errors
                </p>
                {criticalErrors.map((err, i) => (
                  <div key={i} className="rounded bg-error-100/50 p-2 dark:bg-error-900/20">
                    <p className="m-0 text-xs font-medium text-error-900 dark:text-error-100">
                      {err.message}
                    </p>
                    {err.suggestion && (
                      <p className="m-0 mt-1 text-xs text-error-700 dark:text-error-300">
                        {err.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* High priority errors */}
            {highErrors.length > 0 && (
              <div className="space-y-2">
                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-error-900 dark:text-error-100">
                  High Priority Errors
                </p>
                {highErrors.map((err, i) => (
                  <div key={i} className="rounded bg-error-100/50 p-2 dark:bg-error-900/20">
                    <p className="m-0 text-xs font-medium text-error-900 dark:text-error-100">
                      {err.message}
                    </p>
                    {err.suggestion && (
                      <p className="m-0 mt-1 text-xs text-error-700 dark:text-error-300">
                        {err.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Other errors */}
            {otherErrors.length > 0 && (
              <div className="space-y-2">
                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-error-900 dark:text-error-100">
                  Other Errors
                </p>
                {otherErrors.slice(0, 3).map((err, i) => (
                  <div key={i} className="rounded bg-error-100/50 p-2 dark:bg-error-900/20">
                    <p className="m-0 text-xs text-error-900 dark:text-error-100">{err.message}</p>
                  </div>
                ))}
                {otherErrors.length > 3 && (
                  <p className="m-0 text-xs text-error-700 dark:text-error-300">
                    ... and {otherErrors.length - 3} more
                  </p>
                )}
              </div>
            )}

            {/* High priority warnings */}
            {highWarnings.length > 0 && (
              <div className="space-y-2">
                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-warning-900 dark:text-warning-100">
                  High Priority Warnings
                </p>
                {highWarnings.map((warn, i) => (
                  <div key={i} className="rounded bg-warning-100/50 p-2 dark:bg-warning-900/20">
                    <p className="m-0 text-xs font-medium text-warning-900 dark:text-warning-100">
                      {warn.message}
                    </p>
                    {warn.suggestion && (
                      <p className="m-0 mt-1 text-xs text-warning-700 dark:text-warning-300">
                        {warn.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Other warnings */}
            {otherWarnings.length > 0 && (
              <div className="space-y-2">
                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-warning-900 dark:text-warning-100">
                  Warnings
                </p>
                {otherWarnings.slice(0, 2).map((warn, i) => (
                  <div key={i} className="rounded bg-warning-100/50 p-2 dark:bg-warning-900/20">
                    <p className="m-0 text-xs text-warning-900 dark:text-warning-100">{warn.message}</p>
                  </div>
                ))}
                {otherWarnings.length > 2 && (
                  <p className="m-0 text-xs text-warning-700 dark:text-warning-300">
                    ... and {otherWarnings.length - 2} more
                  </p>
                )}
              </div>
            )}

            {/* Refresh button */}
            <button
              onClick={checkBoardAndValidate}
              className="w-full rounded-md border border-current/20 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              Refresh Validation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
