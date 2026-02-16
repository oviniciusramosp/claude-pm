# AC Completion Tracking Debug Guide

## Problema Relatado
O sistema de marcação de ACs (Acceptance Criteria) como prontas parou de funcionar após as últimas modificações.

## Diagnóstico Realizado

### 1. Verificação do Sistema de Parsing ✅
Testei todos os componentes do sistema de parsing:
- ✅ `parseAcs()` - extrai corretamente todos os checkboxes do markdown
- ✅ `formatAcsForPrompt()` - gera a tabela numerada de ACs corretamente
- ✅ `parseAcCompleteJson()` - detecta corretamente JSONs `{"ac_complete": N}`
- ✅ `extractAcCompletions()` - extrai ACs de eventos stream-json corretamente
- ✅ `resolveAcRef()` - resolve referências AC-N corretamente

**Conclusão**: O sistema de parsing está funcionando perfeitamente.

### 2. Verificação da Configuração ✅
- ✅ `CLAUDE_STREAM_OUTPUT=true` está habilitado no `.env`
- ✅ As instruções no `claudeMdManager.js` estão corretas (linhas 47-59)
- ✅ O CLAUDE.md injetado instrui Claude a emitir `{"ac_complete": N}`

**Conclusão**: A configuração está correta.

### 3. Debug Logging Adicionado
Adicionei logs de debug em pontos estratégicos:

#### No `claudeRunner.js` (linha ~389):
```javascript
if (acs.length > 0) {
  process.stdout.write(`[DEBUG] Extracted ${acs.length} ACs from event\n`);
}
for (const ac of acs) {
  const label = ac.type === 'numbered' ? `AC-${ac.index}` : ac.text;
  process.stdout.write(`[PM_AC_COMPLETE] ${label}\n`);
  process.stdout.write(`[DEBUG] Calling onAcComplete with: ${JSON.stringify(ac)}\n`);
  onAcComplete(ac);
}
```

#### No `orchestrator.js` (linhas ~332 e ~629):
```javascript
const onAcComplete = (acRef) => {
  this.logger.info(`[DEBUG] onAcComplete called with: ${JSON.stringify(acRef)}`);
  // ... resto do código
};
```

## Como Usar os Logs de Debug

### Cenário 1: Claude não está emitindo os JSONs
**Sintoma**: Você NÃO verá nenhum log `[DEBUG]` durante a execução da task.

**Diagnóstico**: Claude não está seguindo as instruções do CLAUDE.md injetado.

**Solução**:
1. Verifique se `INJECT_CLAUDE_MD=true` no `.env`
2. Verifique o conteúdo de `<CLAUDE_WORKDIR>/CLAUDE.md` e confirme que a seção `<!-- PRODUCT-MANAGER:START -->` existe
3. Adicione ao `CLAUDE_EXTRA_PROMPT` uma instrução mais explícita:
   ```
   IMPORTANT: Emit {"ac_complete": <number>} JSON on its own line IMMEDIATELY after completing each AC.
   ```

### Cenário 2: JSONs são emitidos mas não detectados
**Sintoma**: Você vê `[PM_AC_COMPLETE]` nos logs, mas NÃO vê `[DEBUG] Extracted N ACs from event`.

**Diagnóstico**: O parsing está falhando porque o JSON não está no formato esperado.

**Solução**:
1. Capture o stdout completo da execução
2. Procure por linhas que contenham `ac_complete`
3. Verifique se o formato está correto: `{"ac_complete": 1}` (sem `"status"`)

### Cenário 3: JSONs são detectados mas callback não é chamado
**Sintoma**: Você vê `[DEBUG] Extracted N ACs from event`, mas NÃO vê `[DEBUG] Calling onAcComplete with:`.

**Diagnóstico**: Problema no código entre a extração e a chamada do callback.

**Solução**: Verificar o código em [claudeRunner.js:389-396](src/claudeRunner.js#L389-L396).

### Cenário 4: Callback é chamado mas checkboxes não são atualizados
**Sintoma**: Você vê todos os logs de debug, incluindo `[DEBUG] onAcComplete called with:`, mas os checkboxes não são marcados.

**Diagnóstico**: Problema no `updateCheckboxesByIndex()` do `LocalBoardClient`.

**Solução**: Verificar:
1. Se a task está sendo encontrada corretamente (`_findTaskById`)
2. Se o regex está funcionando corretamente (linha 188 de `client.js`)
3. Se o arquivo está sendo escrito corretamente

### Cenário 5: Funciona em streaming mas não no fallback
**Sintoma**: ACs são marcados durante a execução, mas após a conclusão alguns ficam desmarcados.

**Diagnóstico**: O fallback `collectedAcIndices` não está funcionando corretamente.

**Solução**: Verificar a função `collectAcCompletionsFromStdout()` em [claudeRunner.js:162-198](src/claudeRunner.js#L162-L198).

## Próximos Passos

1. **Execute uma task simples** com 2-3 ACs e observe os logs
2. **Capture os logs completos** da execução (Feed tab no panel)
3. **Identifique qual cenário** está acontecendo usando os sintomas acima
4. **Compartilhe os logs** comigo para análise mais detalhada

## Logs a Procurar

```
[DEBUG] Extracted N ACs from event    <- Claude emitiu JSON e foi detectado
[PM_AC_COMPLETE] AC-N                  <- Pronto para chamar callback
[DEBUG] Calling onAcComplete with:    <- Chamando callback do runner
[DEBUG] onAcComplete called with:     <- Callback foi invocado no orchestrator
AC completed: AC-N                     <- Checkbox foi atualizado com sucesso
```

Se você vir todos esses logs, o sistema está funcionando. Se algum estiver faltando, identifique qual e siga o diagnóstico acima.

## Removendo os Logs de Debug

Após identificar o problema, remova os logs de debug dos arquivos:
- `src/orchestrator.js` (2 ocorrências)
- `src/claudeRunner.js` (2 ocorrências)

Procure por `[DEBUG]` e remova as linhas correspondentes.
