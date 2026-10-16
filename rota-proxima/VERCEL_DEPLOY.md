# Publicação do Rota Próxima na Vercel

Esta PR prepara a migração. Ela não troca o serviço de produção nem remove o Render.

## Projeto

Importe `EoRichas/Rota-Proxima` e selecione **Root Directory: `rota-proxima`**, Framework **Other**. A configuração `vercel.json` publica somente os arquivos de `static/` e direciona `/api/*` ao mesmo handler Python de produção, em `api/index.py`. A região configurada é São Paulo (`gru1`).

Configure as variáveis da `.env.example` em Preview e Production. Use um projeto Supabase de homologação no Preview: os previews podem fazer escritas quando alguém utilizar o sistema. Não copie dados reais para fixtures ou para a PR.

- `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`: projeto correto do Rota.
- `SUPABASE_SERVICE_ROLE_KEY`: somente servidor, usada pelo job da fila; nunca usar prefixo público ou embutir em JavaScript.
- `CRON_SECRET`: valor aleatório de pelo menos 32 bytes para o processamento programado.
- `AZURE_FUNCTION_UPLOAD_URL`: URL de upload com a chave de função, igual ao ambiente atual.
- `OSRM_URL`: serviço de matriz por vias. O endpoint público é o padrão; pode ser substituído por instância própria sem mudar o código.
- `DELETE_SUPABASE_AFTER_SYNC=false`: mantém as fotos originais no Supabase. Só ativar limpeza depois de validar a recuperação via SharePoint.

## Ordem da publicação

1. Faça backup nativo do banco e evidências. Leia `supabase/DATABASE.md` sobre o baseline histórico ainda pendente de acesso.
2. Aplique a nova migração de outubro em homologação e depois, quando validada, no banco de produção. Não reaplique migrações antigas.
3. Publique também a nova rota Azure `evidence-download-link`, necessária para recuperar fotos antigas já removidas do Supabase.
4. Crie um Preview Vercel usando a branch desta PR. Verifique `/api/health`, login com sessão existente, criação da rota, fotos, entrega/coleta, pesagem, reordenação e exportação ZIP.
5. Para promover, primeiro faça o merge aprovado e publique a versão correspondente na Vercel. Ajuste o domínio somente depois do teste completo. O Render permanece disponível para rollback.

## Limites e tarefas em segundo plano

Novas fotos são redimensionadas para até 1600 px e até aproximadamente 2,6 MB antes do envio; o JSON fica abaixo do limite de payload da Vercel. O backup é montado no navegador, com metadados paginados e downloads temporários diretos do Storage/SharePoint. Uma evidência ausente impede entregar um ZIP marcado como completo.

O upload inicial é síncrono depois de persistir a evidência; nenhum envio depende de thread daemon. A fila usa reserva no PostgreSQL, exclusão concorrente, backoff, oito tentativas e recuperação de reservas abandonadas após dez minutos. O cron configurado roda diariamente às 06:00 UTC (03:00 em São Paulo) e processa até três fotos por chamada. O administrador pode executar **Configurações → Reprocessar fotos pendentes**. Para operação com muitas pendências, aumente a frequência no plano Vercel que suporte esse intervalo; o cron diário é a configuração conservadora inicial, não um SLA de entrega imediata.

O backup operacional inclui tabelas, arquivos e hashes SHA-256. Ele não substitui a recuperação de desastre do Supabase: Auth, senhas, configurações e secrets não são exportados pelo sistema. Faça a exportação fora da janela de alterações para obter consistência entre as páginas.

O planejamento usa vias e tempos estimados do OSRM. Não inclui trânsito ao vivo nem restrições específicas de caminhões (altura, peso, acessos particulares). Confirme a entrada correta dos PEVs. Falhas de rede ou de trajeto não são substituídas por linha reta silenciosamente.

## Validação local

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests
npm ci
npm test
npx playwright install chromium
npm run test:e2e
python scripts/build_static.py
```

O teste de migração usa PostgreSQL em WebAssembly (PGlite) e contratos mínimos das tabelas; não substitui testar a migração contra uma cópia do schema real. O E2E usa a interface e o servidor reais, com respostas simuladas nas integrações remotas. Nenhum teste escreve em produção.

## Rollback

Reverta o domínio/promoção para o Render e o último commit estável. A migração é aditiva; mantenha as colunas e funções novas até avaliar os dados criados, sem apagar a fila ou a situação dos tambores. Não remova fotos originais para economizar espaço durante a transição.
