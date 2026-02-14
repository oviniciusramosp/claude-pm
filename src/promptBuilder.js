function normalizeText(value) {
  if (!value || String(value).trim().length === 0) {
    return '(nao informado)';
  }

  return String(value).trim();
}

export function buildTaskPrompt(task, markdown, extraPrompt = '') {
  const agents = task.agents.length > 0 ? task.agents.join(', ') : '(nenhum agente informado)';

  const basePrompt = [
    'Execute a tarefa descrita abaixo:',
    '',
    'Contexto da tarefa:',
    `- Nome: ${normalizeText(task.name)}`,
    `- ID no Notion: ${normalizeText(task.id)}`,
    `- Tipo: ${normalizeText(task.type)}`,
    `- Prioridade: ${normalizeText(task.priority)}`,
    `- Rode os seguintes agentes para essa tarefa: ${agents}`,
    '',
    normalizeText(markdown || '(sem descricao)'),
    '',
    'Regras de execucao:',
    '- Conclua os Acceptance Criteria da tarefa.',
    '- Ao finalizar com sucesso, crie um commit com mensagem clara e objetiva.',
    '- Nao inclua segredos em codigo, commits ou logs.',
    '',
    'Requisitos de resposta:',
    '- Responda APENAS com um JSON valido em uma unica linha.',
    '- Estrutura obrigatoria:',
    '{"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}',
    '- Use "done" apenas quando a implementacao estiver concluida.',
    '- Se houver bloqueio, use "blocked" e detalhe em notes.',
    ''
  ];

  if (extraPrompt && extraPrompt.trim().length > 0) {
    basePrompt.push('Instrucoes adicionais do operador:');
    basePrompt.push(extraPrompt.trim());
    basePrompt.push('');
  }

  return basePrompt.join('\n');
}

export function buildTaskCompletionNotes(task, execution) {
  const lines = [];
  lines.push(`## Execution Notes (${new Date().toISOString()})`);
  lines.push(`Task: ${task.name}`);

  if (task.url) {
    lines.push(`Reference: ${task.url}`);
  }

  if (execution.summary) {
    lines.push('');
    lines.push('### Summary');
    lines.push(execution.summary);
  }

  if (execution.notes) {
    lines.push('');
    lines.push('### Notes');
    lines.push(execution.notes);
  }

  if (execution.tests) {
    lines.push('');
    lines.push('### Tests');
    lines.push(execution.tests);
  }

  if (Array.isArray(execution.files) && execution.files.length > 0) {
    lines.push('');
    lines.push('### Files');
    for (const file of execution.files) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join('\n');
}

export function formatDuration(ms) {
  if (!ms || ms <= 0) {
    return '0m';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

export function buildEpicSummary(epicTask, summary) {
  const lines = [];
  lines.push(`## Resumo da automacao (${new Date().toISOString()})`);
  lines.push(`Epic: ${epicTask.name}`);

  if (summary.earliest) {
    lines.push(`Inicio estimado: ${summary.earliest}`);
  }

  if (summary.latest) {
    lines.push(`Fim estimado: ${summary.latest}`);
  }

  lines.push(`Duracao acumulada: ${formatDuration(summary.totalDurationMs)}`);
  lines.push('');
  lines.push('Tarefas concluidas:');

  for (const row of summary.rows) {
    lines.push(`- ${row.name} (${formatDuration(row.durationMs || 0)})`);
  }

  return lines.join('\n');
}
