function normalize(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
}

function parsePriority(priority) {
  if (!priority) {
    return Number.POSITIVE_INFINITY;
  }

  const match = String(priority).match(/p(\d+)/i);
  if (!match) {
    return Number.POSITIVE_INFINITY;
  }

  return Number(match[1]);
}

export function sortCandidates(tasks, order) {
  const copied = [...tasks];

  copied.sort((a, b) => {
    if (order === 'priority_then_alphabetical') {
      const priorityDiff = parsePriority(a.priority) - parsePriority(b.priority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
    }

    // Sort by task ID (derived from filename) which preserves deliberate
    // numbering like E01, E02, s1-1, s1-2, etc.
    const idA = normalize(a.id);
    const idB = normalize(b.id);

    return idA.localeCompare(idB);
  });

  return copied;
}

export function isEpicTask(task, tasks, config) {
  const epicType = normalize(config.board.typeValues.epic);
  if (normalize(task.type) === epicType) {
    return true;
  }

  // Sub-task model fallback: any card that has children is treated as an Epic.
  return tasks.some((candidate) => candidate.parentId && candidate.parentId === task.id);
}

export function pickNextTask(tasks, config) {
  const inProgressStatus = normalize(config.board.statuses.inProgress);
  const notStartedStatus = normalize(config.board.statuses.notStarted);

  // Only standalone tasks (no parentId). Epic children are handled by reconcileEpic.
  const workItems = tasks.filter((task) => !isEpicTask(task, tasks, config) && !task.parentId);
  const inProgress = sortCandidates(
    workItems.filter((task) => normalize(task.status) === inProgressStatus),
    config.queue.order
  );

  if (inProgress.length > 0) {
    return {
      source: 'in_progress',
      task: inProgress[0]
    };
  }

  const notStarted = sortCandidates(
    workItems.filter((task) => normalize(task.status) === notStartedStatus),
    config.queue.order
  );

  if (notStarted.length > 0) {
    return {
      source: 'not_started',
      task: notStarted[0]
    };
  }

  return null;
}

export function pickNextEpic(tasks, config) {
  const inProgressStatus = normalize(config.board.statuses.inProgress);
  const notStartedStatus = normalize(config.board.statuses.notStarted);
  const doneStatus = normalize(config.board.statuses.done);

  const epics = tasks.filter((task) => isEpicTask(task, tasks, config));

  // If any epic is already In Progress, resume it (only one at a time).
  const inProgress = sortCandidates(
    epics.filter((task) => normalize(task.status) === inProgressStatus),
    config.queue.order
  );

  if (inProgress.length > 0) {
    return { source: 'in_progress', task: inProgress[0] };
  }

  // Sort all epics to determine sequential order.
  const allSorted = sortCandidates(epics, config.queue.order);

  // Find the first epic that is NOT done. If it's Not Started, start it.
  // If it's in some other state, don't start a later epic.
  for (const epic of allSorted) {
    const status = normalize(epic.status);

    if (status === doneStatus) {
      continue;
    }

    if (status === notStartedStatus) {
      return { source: 'not_started', task: epic };
    }

    // Epic is in a non-done, non-not-started state (shouldn't happen normally).
    // Block progression — don't skip to later epics.
    return null;
  }

  return null;
}

export function pickNextEpicChild(tasks, config, epicId) {
  const inProgressStatus = normalize(config.board.statuses.inProgress);
  const notStartedStatus = normalize(config.board.statuses.notStarted);

  const children = tasks.filter(
    (task) => !isEpicTask(task, tasks, config) && task.parentId === epicId
  );

  const inProgress = sortCandidates(
    children.filter((task) => normalize(task.status) === inProgressStatus),
    config.queue.order
  );

  if (inProgress.length > 0) {
    return { source: 'in_progress', task: inProgress[0] };
  }

  const notStarted = sortCandidates(
    children.filter((task) => normalize(task.status) === notStartedStatus),
    config.queue.order
  );

  if (notStarted.length > 0) {
    return { source: 'not_started', task: notStarted[0] };
  }

  return null;
}

export function hasIncompleteEpic(tasks, config) {
  const doneStatus = normalize(config.board.statuses.done);

  return tasks.some(
    (task) => isEpicTask(task, tasks, config) && normalize(task.status) !== doneStatus
  );
}

export function allEpicChildrenAreDone(epic, tasks, config) {
  const doneStatus = normalize(config.board.statuses.done);

  const children = tasks.filter(
    (task) => !isEpicTask(task, tasks, config) && task.parentId && task.parentId === epic.id
  );

  if (children.length === 0) {
    return {
      allDone: false,
      children
    };
  }

  return {
    allDone: children.every((child) => normalize(child.status) === doneStatus),
    children
  };
}
