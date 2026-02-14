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

function sortCandidates(tasks, order) {
  const copied = [...tasks];

  copied.sort((a, b) => {
    if (order === 'priority_then_alphabetical') {
      const priorityDiff = parsePriority(a.priority) - parsePriority(b.priority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
    }

    const nameA = normalize(a.name);
    const nameB = normalize(b.name);

    return nameA.localeCompare(nameB);
  });

  return copied;
}

export function isEpicTask(task, tasks, config) {
  const epicType = normalize(config.notion.typeValues.epic);
  if (normalize(task.type) === epicType) {
    return true;
  }

  // Sub-task model fallback: any card that has children is treated as an Epic.
  return tasks.some((candidate) => candidate.parentId && candidate.parentId === task.id);
}

export function pickNextTask(tasks, config) {
  const inProgressStatus = normalize(config.notion.statuses.inProgress);
  const notStartedStatus = normalize(config.notion.statuses.notStarted);

  const workItems = tasks.filter((task) => !isEpicTask(task, tasks, config));
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
  const inProgressStatus = normalize(config.notion.statuses.inProgress);
  const notStartedStatus = normalize(config.notion.statuses.notStarted);

  const epics = tasks.filter((task) => isEpicTask(task, tasks, config));

  const inProgress = sortCandidates(
    epics.filter((task) => normalize(task.status) === inProgressStatus),
    config.queue.order
  );

  if (inProgress.length > 0) {
    return { source: 'in_progress', task: inProgress[0] };
  }

  const notStarted = sortCandidates(
    epics.filter((task) => normalize(task.status) === notStartedStatus),
    config.queue.order
  );

  if (notStarted.length > 0) {
    return { source: 'not_started', task: notStarted[0] };
  }

  return null;
}

export function pickNextEpicChild(tasks, config, epicId) {
  const inProgressStatus = normalize(config.notion.statuses.inProgress);
  const notStartedStatus = normalize(config.notion.statuses.notStarted);

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

export function allEpicChildrenAreDone(epic, tasks, config) {
  const doneStatus = normalize(config.notion.statuses.done);

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
