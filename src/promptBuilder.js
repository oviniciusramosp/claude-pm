function normalizeText(value) {
  if (!value || String(value).trim().length === 0) {
    return '(nao informado)';
  }

  return String(value).trim();
}

export function buildTaskPrompt(task, markdown, options = {}) {
  const {
    extraPrompt = '',
    forceTestCreation = false,
    forceTestRun = false,
    forceCommit = false
  } = typeof options === 'string' ? { extraPrompt: options } : options;

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
    ''
  ];

  if (forceTestCreation || forceTestRun || forceCommit) {
    basePrompt.push('Regras obrigatorias ao finalizar:');

    if (forceTestCreation) {
      basePrompt.push('- Ao terminar a tarefa, certifique-se de que testes automatizados para ela foram criados (quando fizer sentido).');
    }

    if (forceTestRun) {
      basePrompt.push('- Ao terminar a tarefa, certifique-se de rodar os testes e todos eles passarem.');
    }

    if (forceCommit) {
      basePrompt.push('- Ao terminar a tarefa, se tudo estiver ok, crie o commit para mim antes de mover as tarefas para Done no Notion.');
    }

    basePrompt.push('');
  }

  basePrompt.push('Requisitos de resposta:');
  basePrompt.push('- Responda APENAS com um JSON valido em uma unica linha.');
  basePrompt.push('- Estrutura obrigatoria:');
  basePrompt.push('{"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}');
  basePrompt.push('- Use "done" apenas quando a implementacao estiver concluida.');
  basePrompt.push('- Se houver bloqueio, use "blocked" e detalhe em notes.');
  basePrompt.push('');

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

export function buildReviewPrompt(task, markdown, executionResult) {
  const agents = task.agents.length > 0 ? task.agents.join(', ') : '(nenhum agente informado)';
  const filesList = Array.isArray(executionResult.files) && executionResult.files.length > 0
    ? executionResult.files.join(', ')
    : '(nenhum)';

  const lines = [
    'Voce esta revisando o trabalho feito por outro modelo Claude na tarefa abaixo.',
    'Seu papel e verificar se a implementacao atende aos criterios de aceitacao, identificar problemas e corrigi-los.',
    '',
    'Contexto da tarefa:',
    `- Nome: ${normalizeText(task.name)}`,
    `- ID no Notion: ${normalizeText(task.id)}`,
    `- Tipo: ${normalizeText(task.type)}`,
    `- Prioridade: ${normalizeText(task.priority)}`,
    `- Agentes: ${agents}`,
    '',
    '## Descricao original da tarefa',
    normalizeText(markdown || '(sem descricao)'),
    '',
    '## Resultado da execucao anterior',
    `- Status: ${executionResult.status || 'done'}`,
    `- Resumo: ${executionResult.summary || '(nenhum)'}`,
    `- Notas: ${executionResult.notes || '(nenhum)'}`,
    `- Testes: ${executionResult.tests || '(nenhum)'}`,
    `- Arquivos alterados: ${filesList}`,
    '',
    'Instrucoes de revisao:',
    '- Verifique se todos os Acceptance Criteria da descricao da tarefa foram atendidos.',
    '- Revise os arquivos alterados quanto a corretude, qualidade de codigo e aderencia as convencoes do projeto.',
    '- Se encontrar problemas, corrija-os diretamente. Crie um commit com suas correcoes.',
    '- Se tudo estiver correto ou voce corrigiu todos os problemas, retorne status "done".',
    '- Use "blocked" apenas se houver um problema que voce nao consegue resolver (acesso faltando, dependencia externa, requisitos ambiguos).',
    '- Nao exponha segredos em codigo, commits ou logs.',
    '',
    'Requisitos de resposta:',
    '- Responda APENAS com um JSON valido em uma unica linha.',
    '- Estrutura obrigatoria:',
    '{"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}',
    '- Use "done" quando a implementacao estiver verificada e correta (com ou sem suas correcoes).',
    '- Use "blocked" apenas para problemas que voce nao consegue resolver, e detalhe o motivo em notes.',
    ''
  ];

  return lines.join('\n');
}

export function buildEpicReviewPrompt(epicTask, children, epicSummary) {
  const childList = children.map((child) => {
    const row = epicSummary.rows.find((r) => r.id === child.id);
    const duration = row?.durationMs ? formatDuration(row.durationMs) : '(sem dados)';
    return `- ${child.name} (duracao: ${duration})`;
  }).join('\n');

  const lines = [
    'Voce esta revisando um Epic completo. Todas as sub-tarefas foram concluidas por outros modelos.',
    'Seu papel e garantir que a implementacao do Epic como um todo esta correta e funcional.',
    '',
    'Contexto do Epic:',
    `- Nome: ${normalizeText(epicTask.name)}`,
    `- ID no Notion: ${normalizeText(epicTask.id)}`,
    `- Tipo: ${normalizeText(epicTask.type)}`,
    `- Prioridade: ${normalizeText(epicTask.priority)}`,
    `- Duracao total acumulada: ${formatDuration(epicSummary.totalDurationMs)}`,
    '',
    '## Sub-tarefas concluidas',
    childList,
    '',
    'Instrucoes de revisao:',
    '1. Rode todos os testes automatizados do projeto (npm test, npm run test, ou o comando de teste disponivel).',
    '2. Revise a implementacao completa do Epic, verificando consistencia entre as sub-tarefas.',
    '3. Verifique qualidade de codigo, aderencia as convencoes do projeto e ausencia de regressoes.',
    '4. Se encontrar problemas (testes falhando, bugs, inconsistencias), corrija-os diretamente.',
    '5. Crie um commit com suas correcoes se houver alteracoes.',
    '',
    'Criterios de aprovacao:',
    '- Todos os testes automatizados passando.',
    '- Implementacao consistente e sem regressoes.',
    '- Codigo seguindo as convencoes do projeto.',
    '',
    'Requisitos de resposta:',
    '- Responda APENAS com um JSON valido em uma unica linha.',
    '- Estrutura obrigatoria:',
    '{"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}',
    '- Use "done" quando tudo estiver verificado e correto (com ou sem suas correcoes).',
    '- Use "blocked" apenas para problemas que voce nao consegue resolver.',
    '- No campo "tests", inclua o resultado da execucao dos testes.',
    ''
  ];

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
