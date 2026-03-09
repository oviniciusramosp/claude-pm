import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveAcRef } from './acParser.js';

const DEFAULT_CLAUDE_COMMAND = 'claude --print';

function isLikelyTaskContract(line) {
  const trimmed = (line || '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }

  return /^\{.*"status"\s*:\s*"(done|blocked)"/.test(trimmed);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}

function formatToolProgress(block) {
  const name = block.name || 'Tool';
  const input = block.input || {};

  switch (name) {
    case 'Read':
      return `Read → ${input.file_path || '(file)'}`;
    case 'Edit':
      return `Edit → ${input.file_path || '(file)'}`;
    case 'Write':
      return `Write → ${input.file_path || '(file)'}`;
    case 'NotebookEdit':
      return `NotebookEdit → ${input.notebook_path || '(notebook)'}`;
    case 'Bash': {
      const cmd = input.command || '';
      return `Bash → ${cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd}`;
    }
    case 'Grep':
      return `Grep → "${input.pattern || ''}"${input.path ? ' in ' + input.path : ''}`;
    case 'Glob':
      return `Glob → ${input.pattern || '(pattern)'}`;
    case 'Task':
      return `Task → ${input.description || '(subagent)'}`;
    case 'WebSearch':
      return `WebSearch → "${input.query || ''}"`;
    case 'WebFetch':
      return `WebFetch → ${input.url || '(url)'}`;
    default:
      return name;
  }
}

function extractToolUseProgress(event) {
  if (!event || event.role !== 'assistant') {
    return null;
  }

  const content = Array.isArray(event.content) ? event.content : [];
  const toolBlocks = content.filter((c) => c.type === 'tool_use');
  if (toolBlocks.length === 0) {
    return null;
  }

  return toolBlocks.map(formatToolProgress);
}

const LEGACY_AC_MARKER = '[AC_COMPLETE] ';

function parseAcCompleteJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  if (!trimmed.includes('"ac_complete"')) {
    return null;
  }
  if (trimmed.includes('"status"')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed.ac_complete === 'number' &&
      Number.isInteger(parsed.ac_complete) &&
      parsed.ac_complete > 0
    ) {
      return parsed.ac_complete;
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

function isAcCompleteJson(line) {
  const trimmed = (line || '').trim();
  return (
    trimmed.startsWith('{') &&
    trimmed.includes('"ac_complete"') &&
    !trimmed.includes('"status"')
  );
}

function extractAcCompletions(event) {
  if (!event || event.role !== 'assistant') {
    return [];
  }

  const content = Array.isArray(event.content) ? event.content : [];
  const completed = [];

  for (const block of content) {
    if (block.type !== 'text' || !block.text) {
      continue;
    }

    const lines = block.text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // New format: per-AC JSON
      const acNumber = parseAcCompleteJson(trimmed);
      if (acNumber !== null) {
        completed.push({ type: 'numbered', index: acNumber });
        continue;
      }

      // Legacy fallback: [AC_COMPLETE] AC-<number>
      if (trimmed.startsWith(LEGACY_AC_MARKER)) {
        const acRaw = trimmed.slice(LEGACY_AC_MARKER.length).trim();
        if (acRaw) {
          completed.push(resolveAcRef(acRaw));
        }
      }
    }
  }

  return completed;
}

function extractAcFromPlainLine(line) {
  const trimmed = (line || '').trim();

  // New format: per-AC JSON
  const acNumber = parseAcCompleteJson(trimmed);
  if (acNumber !== null) {
    return { type: 'numbered', index: acNumber };
  }

  // Legacy fallback: [AC_COMPLETE] AC-<number>
  if (trimmed.startsWith(LEGACY_AC_MARKER)) {
    const acRaw = trimmed.slice(LEGACY_AC_MARKER.length).trim();
    return acRaw ? resolveAcRef(acRaw) : null;
  }

  return null;
}

function collectAcCompletionsFromStdout(stdout, isStreamJson) {
  const results = [];
  if (!stdout) {
    return results;
  }

  const lines = stdout.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    if (isStreamJson) {
      const event = parseJsonLine(line);
      if (!event || event.role !== 'assistant') {
        continue;
      }
      const content = Array.isArray(event.content) ? event.content : [];
      for (const block of content) {
        if (block.type !== 'text' || !block.text) {
          continue;
        }
        const textLines = block.text.split('\n');
        for (const textLine of textLines) {
          const acNum = parseAcCompleteJson(textLine.trim());
          if (acNum !== null) {
            results.push(acNum);
          }
        }
      }
    } else {
      const acNum = parseAcCompleteJson(line.trim());
      if (acNum !== null) {
        results.push(acNum);
      }
    }
  }

  return [...new Set(results)];
}

function extractUsageFromStreamJson(stdout) {
  const lines = (stdout || '').trim().split('\n').filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const event = parseJsonLine(lines[i]);
    if (!event || event.type !== 'result' || !event.usage) {
      continue;
    }

    const u = event.usage;
    return {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheCreationInputTokens: u.cache_creation_input_tokens || 0,
      cacheReadInputTokens: u.cache_read_input_tokens || 0,
      totalCostUsd: event.total_cost_usd || 0
    };
  }

  return null;
}

function parseStreamJsonResult(stdout) {
  const lines = (stdout || '').trim().split('\n').filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const event = parseJsonLine(lines[i]);
    if (!event || event.role !== 'assistant') {
      continue;
    }

    const content = Array.isArray(event.content) ? event.content : [];
    for (let j = content.length - 1; j >= 0; j -= 1) {
      if (content[j].type !== 'text') {
        continue;
      }

      const text = (content[j].text || '').trim();
      const jsonMatch = text.match(/\{[\s\S]*"status"\s*:\s*"(done|blocked)"[\s\S]*\}/);
      if (!jsonMatch) {
        continue;
      }

      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        continue;
      }
    }
  }

  return null;
}

function parseJsonFromOutput(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!(line.startsWith('{') && line.endsWith('}'))) {
      continue;
    }

    // Skip per-AC completion markers
    if (line.includes('"ac_complete"') && !line.includes('"status"')) {
      continue;
    }

    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

const VALID_MODEL_PATTERN = /^claude-[a-z0-9.-]+$/;

function validateModelName(model) {
  if (!VALID_MODEL_PATTERN.test(model)) {
    throw new Error(`Invalid model name: "${model}". Model must match pattern: claude-<alphanumeric/dots/hyphens>`);
  }
}

function buildCommand(config, task, overrideModel, { sessionId, resume } = {}) {
  let cmd = config.claude.command || DEFAULT_CLAUDE_COMMAND;

  const model = overrideModel || config.claude.modelOverride || task.model;
  if (model) {
    validateModelName(model);
    cmd += ` --model ${model}`;
  }

  if (config.claude.fullAccess && !cmd.includes('--dangerously-skip-permissions')) {
    cmd += ' --dangerously-skip-permissions';
  }

  if (config.claude.streamOutput) {
    cmd += ' --verbose --output-format stream-json';
  }

  // Session management for auto-compact support
  if (resume) {
    cmd += ` --resume ${resume}`;
  } else if (sessionId) {
    cmd += ` --session-id ${sessionId}`;
  }

  return cmd;
}

/**
 * Build the environment for Claude subprocess, cleaning nested session vars.
 */
function buildClaudeEnv(config, task) {
  const commandEnv = { ...process.env };
  // Remove Claude Code session env vars so each task runs as a fresh, independent invocation.
  // Without this, Claude Code detects a nested session and exits with code 1.
  for (const key of Object.keys(commandEnv)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) {
      delete commandEnv[key];
    }
  }
  // Re-apply the OAuth token AFTER the cleanup loop, so it is not deleted above.
  if (config.claude.oauthToken) {
    commandEnv.CLAUDE_CODE_OAUTH_TOKEN = config.claude.oauthToken;
  }

  return {
    ...commandEnv,
    PM_TASK_ID: task.id,
    PM_TASK_NAME: task.name,
    PM_TASK_TYPE: task.type || '',
    PM_TASK_PRIORITY: task.priority || ''
  };
}

/**
 * Internal constant: sentinel exit code used to signal that the process was killed
 * by the auto-compact logic (not a real failure).
 */
const COMPACT_KILL_SIGNAL = 'PM_COMPACT';

/**
 * Run a single Claude session. Returns a result object.
 * When compactThreshold > 0 and the tool call count reaches it, the process is
 * killed and the result includes `_compactNeeded: true` so the caller can resume.
 */
function killWithEscalation(child) {
  try { child.kill('SIGTERM'); } catch { /* already dead */ }
  // If process ignores SIGTERM, escalate to SIGKILL after 10s
  const escalation = setTimeout(() => {
    try {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    } catch { /* already dead */ }
  }, 10_000);
  escalation.unref();
  return escalation;
}

function runSingleSession(task, prompt, config, { signal, onAcComplete, overrideModel, sessionId, resume, compactThreshold = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      const env = buildClaudeEnv(config, task);
      const command = buildCommand(config, task, overrideModel, { sessionId, resume });
      child = spawn(command, {
        shell: true,
        cwd: config.claude.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });
    } catch (spawnErr) {
      reject(new Error(`Failed to spawn Claude process: ${spawnErr.message}`));
      return;
    }

    let escalationTimer = null;

    function onAbort() {
      escalationTimer = killWithEscalation(child);
    }

    if (signal) {
      if (signal.aborted) {
        escalationTimer = killWithEscalation(child);
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let stdout = '';
    let stderr = '';
    let streamLineBuffer = '';
    let streamJsonDetected = false;
    let toolCallCount = 0;
    let compactKilled = false;
    const isStreamJsonMode = child.spawnargs?.join(' ').includes('--output-format stream-json')
      || (config.claude.streamOutput);

    // Safety timeout: only kills truly zombie processes (no progress for the full duration).
    // With Claude Code Max there are no rate limits, so this is intentionally generous.
    // The watchdog heartbeat (reset on AC completions) is the primary protection against stalls.
    const timer = setTimeout(() => {
      escalationTimer = killWithEscalation(child);
    }, config.claude.timeoutMs);

    child.stdout.on('data', (chunk) => {
      const output = String(chunk);
      stdout += output;

      if (config.claude.streamOutput) {
        streamLineBuffer += output;
        const lines = streamLineBuffer.split('\n');
        streamLineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (isStreamJsonMode) {
            const event = parseJsonLine(line);
            if (event) {
              streamJsonDetected = true;

              // Count tool calls for auto-compact threshold
              const toolMessages = extractToolUseProgress(event);
              if (toolMessages) {
                toolCallCount += toolMessages.length;
                for (const msg of toolMessages) {
                  process.stdout.write(`[PM_PROGRESS] ${msg}\n`);
                }

                // Check if we should trigger compact (kill-and-resume)
                if (compactThreshold > 0 && toolCallCount >= compactThreshold && !compactKilled) {
                  compactKilled = true;
                  process.stdout.write(`[PM_COMPACT] Tool call threshold reached (${toolCallCount}/${compactThreshold}). Killing session for resume with compaction.\n`);
                  child.kill('SIGTERM');
                }
              }

              if (onAcComplete) {
                const acs = extractAcCompletions(event);
                for (const ac of acs) {
                  const label = ac.type === 'numbered' ? `AC-${ac.index}` : ac.text;
                  process.stdout.write(`[PM_AC_COMPLETE] ${label}\n`);
                  onAcComplete(ac);
                }
              }
            }
            continue;
          }

          if (onAcComplete) {
            const ac = extractAcFromPlainLine(line);
            if (ac) {
              const label = ac.type === 'numbered' ? `AC-${ac.index}` : ac.text;
              process.stdout.write(`[PM_AC_COMPLETE] ${label}\n`);
              onAcComplete(ac);
              continue;
            }
          }

          if (isLikelyTaskContract(line) || isAcCompleteJson(line)) {
            continue;
          }
          process.stdout.write(line + '\n');
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const output = String(chunk);
      stderr += output;

      if (config.claude.streamOutput) {
        process.stderr.write(output);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(error);
    });

    child.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (config.claude.streamOutput && streamLineBuffer.trim()) {
        if (!isLikelyTaskContract(streamLineBuffer) && !isAcCompleteJson(streamLineBuffer)) {
          process.stdout.write(streamLineBuffer + '\n');
        }
        streamLineBuffer = '';
      }

      // If we killed the process for compaction, resolve with a special marker
      if (compactKilled) {
        const collectedAcs = collectAcCompletionsFromStdout(stdout, streamJsonDetected);
        resolve({
          _compactNeeded: true,
          toolCallCount,
          collectedAcIndices: collectedAcs,
          usage: streamJsonDetected ? extractUsageFromStreamJson(stdout) : null,
          stdout,
          stderr
        });
        return;
      }

      if (code !== 0) {
        const error = new Error('Claude command failed');
        error.exitCode = code;
        error.signal = exitSignal || 'none';
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
        return;
      }

      const parsed = (streamJsonDetected ? parseStreamJsonResult(stdout) : parseJsonFromOutput(stdout)) || {};
      const collectedAcs = collectAcCompletionsFromStdout(stdout, streamJsonDetected);

      // Diagnostic: warn if execution completed with done status but no ACs were emitted
      if (parsed.status === 'done' && collectedAcs.length === 0) {
        process.stdout.write(`[PM_WARNING] Task marked as done but NO {"ac_complete": N} markers were detected in output.\n`);
        process.stdout.write(`[PM_WARNING] This likely means the model (Sonnet) ignored AC tracking instructions.\n`);
        process.stdout.write(`[PM_WARNING] AC verification will fail and trigger automatic AC fix.\n`);
      }

      resolve({
        status: parsed.status || 'done',
        summary: parsed.summary || '',
        notes: parsed.notes || '',
        files: Array.isArray(parsed.files) ? parsed.files : [],
        tests: parsed.tests || '',
        collectedAcIndices: collectedAcs,
        usage: streamJsonDetected ? extractUsageFromStreamJson(stdout) : null,
        stdout,
        stderr
      });
    });

    child.stdin.on('error', (err) => {
      // Only suppress EPIPE (process exited before reading stdin).
      // Other errors (e.g. ENOMEM) should propagate.
      if (err.code !== 'EPIPE') {
        reject(err);
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const RESUME_PROMPT = 'Continue the task from where you left off. Complete any remaining acceptance criteria. Remember to emit {"ac_complete": <number>} for each AC you complete and the final JSON when done.';

/**
 * Run a Claude task with automatic compaction support.
 *
 * When auto-compact is enabled and CLAUDE_STREAM_OUTPUT=true, the runner monitors
 * tool call count during execution. When the threshold is reached, it kills the
 * current session and resumes it via `--resume <session-id>`. Claude Code
 * auto-compacts the conversation history when loading a resumed session that
 * approaches context limits.
 *
 * This is transparent to the orchestrator — the function returns the same result
 * shape regardless of whether compaction cycles occurred.
 */
export function runClaudeTask(task, prompt, config, { signal, onAcComplete, overrideModel } = {}) {
  const autoCompactEnabled = config.claude.autoCompact && config.claude.streamOutput;
  const threshold = config.claude.compactThreshold;
  const maxCycles = config.claude.maxCompactCycles || 3;

  // If auto-compact is disabled or stream output is off, run a single session (original behavior)
  if (!autoCompactEnabled || threshold <= 0) {
    return runSingleSession(task, prompt, config, { signal, onAcComplete, overrideModel });
  }

  // Auto-compact enabled: run with kill-and-resume cycles
  return (async () => {
    const sessionId = randomUUID();
    let totalToolCalls = 0;
    let allCollectedAcs = [];
    let allUsage = null;

    // First session: use the original prompt and a fresh session-id
    let result = await runSingleSession(task, prompt, config, {
      signal,
      onAcComplete,
      overrideModel,
      sessionId,
      compactThreshold: threshold
    });

    totalToolCalls += result.toolCallCount || 0;
    allCollectedAcs = [...(result.collectedAcIndices || [])];
    allUsage = mergeUsage(allUsage, result.usage);

    let cycle = 0;
    while (result._compactNeeded && cycle < maxCycles) {
      cycle += 1;
      process.stdout.write(`[PM_COMPACT] Resuming session ${sessionId} (cycle ${cycle}/${maxCycles}, total tool calls: ${totalToolCalls})\n`);

      // Resume the same session — Claude Code loads the conversation history
      // and auto-compacts it to fit within the context window
      result = await runSingleSession(task, RESUME_PROMPT, config, {
        signal,
        onAcComplete,
        overrideModel,
        resume: sessionId,
        compactThreshold: threshold
      });

      totalToolCalls += result.toolCallCount || 0;
      allCollectedAcs = [...new Set([...allCollectedAcs, ...(result.collectedAcIndices || [])])];
      allUsage = mergeUsage(allUsage, result.usage);
    }

    if (result._compactNeeded) {
      // Exhausted all compact cycles but task is still running — treat as timeout
      process.stdout.write(`[PM_COMPACT] Max compact cycles (${maxCycles}) exhausted after ${totalToolCalls} tool calls. Task may be incomplete.\n`);
      return {
        status: 'blocked',
        summary: `Auto-compact exhausted ${maxCycles} cycles (${totalToolCalls} tool calls). Task incomplete.`,
        notes: '',
        files: [],
        tests: '',
        collectedAcIndices: allCollectedAcs,
        usage: allUsage,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    // Final result from the last session — merge accumulated ACs and usage
    return {
      ...result,
      collectedAcIndices: [...new Set([...allCollectedAcs, ...(result.collectedAcIndices || [])])],
      usage: mergeUsage(allUsage, result.usage)
    };
  })();
}

/**
 * Merge two usage objects, summing their token counts.
 */
function mergeUsage(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
    outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
    cacheCreationInputTokens: (a.cacheCreationInputTokens || 0) + (b.cacheCreationInputTokens || 0),
    cacheReadInputTokens: (a.cacheReadInputTokens || 0) + (b.cacheReadInputTokens || 0),
    totalCostUsd: (a.totalCostUsd || 0) + (b.totalCostUsd || 0)
  };
}
