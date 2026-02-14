import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();
const FIXED_CLAUDE_COMMAND = '/opt/homebrew/bin/claude --print';

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    help: args.has('--help') || args.has('-h')
  };
}

function runClaude(command, prompt, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => reject(error));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Falha ao executar Claude (exit=${code}): ${stderr || stdout || 'sem output'}`));
        return;
      }

      resolve(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function resolveClaudeCommand(baseCommand, fullAccess) {
  const trimmed = baseCommand.trim();
  let command = trimmed;

  if (!command.includes('--permission-mode')) {
    command = `${command} --permission-mode acceptEdits`;
  }

  if (fullAccess && !command.includes('--dangerously-skip-permissions')) {
    command = `${command} --dangerously-skip-permissions`;
  }

  return command;
}

function buildPrompt(context) {
  const existingFileInfo = context.existingContent
    ? [
        'Conteudo atual de CLAUDE.md (use como base para atualizar sem perder contexto):',
        '---',
        context.existingContent,
        '---',
        ''
      ]
    : [
        'Nao existe CLAUDE.md ainda neste repositorio.',
        'Crie o arquivo CLAUDE.md com a estrutura abaixo.',
        ''
      ];

  return [
    'Atualize o arquivo CLAUDE.md DESTE repositorio usando ferramentas de arquivo (Edit/Write).',
    'Nao responda com o conteudo completo do arquivo.',
    'Edite o arquivo in-place preservando seções uteis existentes.',
    'Nao apague instrucoes validas ja existentes sem necessidade.',
    '',
    ...existingFileInfo,
    '',
    'Contexto do projeto:',
    '- Projeto: Product Manager Automation (Notion + Claude Code).',
    '- Objetivo: executar cards do Notion automaticamente, implementar no repositorio, e reportar resultados.',
    `- Notion database id: ${context.notionDatabaseId}`,
    `- Notion status: ${context.notStarted} -> ${context.inProgress} -> ${context.done}`,
    '- Tipos de tarefa: Epic, UserStory, Defect, Discovery.',
    '- Sub-tasks usam Parent item para vinculo ao Epic.',
    '',
    'Conteudo obrigatorio do CLAUDE.md:',
    '1) Um resumo rapido do fluxo operacional esperado do agente.',
    '2) Checklist de execucao por task:',
    '   - ler card atual e criterios',
    '   - implementar',
    '   - rodar validacoes locais relevantes',
    '   - criar commit ao concluir (mensagem objetiva)',
    '   - ao concluir, mover o card para Done via Notion API quando o fluxo exigir atualizacao manual',
    '   - retornar um JSON final no formato usado pela automacao.',
    '3) Secao de Notion:',
    '   - usar variavel de ambiente NOTION_API_TOKEN quando precisar chamar API',
    '   - nunca hardcodar token no repositorio',
    '   - sempre incluir URL/ID do card como referencia no output.',
    '4) Secao de seguranca: nao vazar segredos em logs, commits, codigo ou docs.',
    '5) Secao de padrao de resposta com JSON:',
    '   {"status":"done|blocked","summary":"...","notes":"...","files":["..."],"tests":"..."}',
    '6) Secao de git com convencoes de commit curtas e praticas.',
    '',
    'Importante:',
    '- Nao inclua valores reais de tokens no arquivo.',
    '- Se mencionar credenciais, referencie somente nomes de variaveis de ambiente.',
    '- O texto deve ser pratico, direto e orientado a execucao.',
    '- No final, responda APENAS um JSON de uma linha:',
    '  {"status":"ok|blocked","summary":"...","changes":["..."]}',
    ''
  ].join('\n');
}

async function main() {
  const { help } = parseArgs(process.argv);

  if (help) {
    console.log('Uso: npm run setup:claude-md');
    console.log('Atualiza (ou cria) CLAUDE.md via Claude, sem sobrescrever direto pelo script.');
    return;
  }

  const targetPath = path.resolve(process.cwd(), 'CLAUDE.md');

  const baseCommand = process.env.CLAUDE_COMMAND || FIXED_CLAUDE_COMMAND;
  const fullAccess = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CLAUDE_FULL_ACCESS || '').toLowerCase()
  );
  const command = resolveClaudeCommand(baseCommand, fullAccess);
  const notionDatabaseId = process.env.NOTION_DATABASE_ID || '(not configured)';
  const notStarted = process.env.NOTION_STATUS_NOT_STARTED || 'Not Started';
  const inProgress = process.env.NOTION_STATUS_IN_PROGRESS || 'In Progress';
  const done = process.env.NOTION_STATUS_DONE || 'Done';

  let existingContent = '';
  let existedBefore = false;
  try {
    existingContent = await fs.readFile(targetPath, 'utf8');
    existedBefore = true;
  } catch {
    existingContent = '';
  }

  const prompt = buildPrompt({
    notionDatabaseId,
    notStarted,
    inProgress,
    done,
    existingContent
  });

  const env = {
    ...process.env
  };

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  const response = await runClaude(command, prompt, env);

  let fileExistsNow = false;
  let updatedContent = '';
  try {
    updatedContent = await fs.readFile(targetPath, 'utf8');
    fileExistsNow = true;
  } catch {
    fileExistsNow = false;
  }

  if (!fileExistsNow) {
    throw new Error('Claude nao criou/atualizou CLAUDE.md.');
  }

  const changed = !existedBefore || existingContent !== updatedContent;
  if (!changed) {
    console.warn('Claude executou, mas CLAUDE.md nao mudou.');
  }

  console.log(`CLAUDE.md processado em: ${targetPath}`);
  if (response) {
    console.log(response);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
