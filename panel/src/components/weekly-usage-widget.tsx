import React from 'react';
import type { WeeklyUsageData } from '../types';

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}

function formatCost(usd: number): string {
  if (usd <= 0) return '';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function WeeklyUsageWidget({ usage }: { usage: WeeklyUsageData | null }) {
  if (!usage || !usage.ok) {
    return null;
  }

  const cost = formatCost(usage.totalCostUsd ?? 0);

  return (
    <div className="px-3">
      <div className="rounded-lg border border-secondary bg-secondary px-3 py-2.5">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-quaternary">
          Project Usage
        </p>

        {/* Token total */}
        <p className="m-0 mt-1.5 text-lg font-semibold leading-tight text-primary">
          {formatTokenCount(usage.totalTokens)}
          <span className="ml-1 text-xs font-normal text-quaternary">tokens</span>
        </p>

        {/* Breakdown + cost */}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-quaternary">
          <span>{formatTokenCount(usage.inputTokens)} in</span>
          <span className="text-quaternary/40">/</span>
          <span>{formatTokenCount(usage.outputTokens)} out</span>
          {cost ? (
            <>
              <span className="text-quaternary/40">/</span>
              <span>{cost}</span>
            </>
          ) : null}
        </div>

        {/* Task count + week label */}
        {usage.taskCount > 0 ? (
          <p className="m-0 mt-1.5 text-[10px] text-quaternary">
            {usage.taskCount} task{usage.taskCount !== 1 ? 's' : ''} this week
          </p>
        ) : (
          <p className="m-0 mt-1.5 text-[10px] text-quaternary">
            No tasks this week
          </p>
        )}
      </div>
    </div>
  );
}
