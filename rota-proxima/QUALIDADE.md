# Perfil Qualidade

O administrador pode selecionar **Qualidade** ao criar ou editar um usuário. Esse perfil abre diretamente o histórico e tem apenas dois itens no menu:

* Histórico de rotas finalizadas, de todos os motoristas, com detalhes para consulta.
* Relatório operacional, com filtros, comparativo e exportação PDF/Excel.

O relatório mantém o escopo operacional existente, incluindo operações em andamento e excluindo rascunhos. O histórico e seus detalhes ficam restritos a rotas finalizadas.

A troca da própria senha e a saída da sessão continuam disponíveis. Não há acesso aos cadastros, planejamento, execução, pesagens, dashboard, configurações ou gerenciamento de usuários. A API bloqueia gravações do perfil e a migração acrescenta políticas restritivas no banco, inclusive para um antigo motorista convertido em Qualidade.

## Publicação

A alteração exige três componentes. Publicar somente o frontend não permite criar o perfil.

1. Aplicar `supabase/migrations/20260924195844_quality_read_only_access.sql` no projeto usado por `SUPABASE_URL`. A migração foi preparada a partir das políticas e da restrição de perfis consultadas nesse projeto. Executar primeiro em homologação ou cópia do banco.
2. Publicar `supabase/functions/rota-admin/index.ts` no mesmo projeto.
3. Publicar o servidor e os arquivos estáticos deste commit. O comando de inicialização continua `python server_final.py`.
4. Criar uma conta de teste Qualidade pelo administrador, trocar a senha no primeiro acesso, consultar histórico e relatório e conferir os dois formatos de exportação. Tentar acesso a outros módulos e confirmar a negativa.

Nenhuma conta real, migração ou publicação em produção foi realizada durante a preparação desta alteração.

## Reversão

Antes da publicação, registrar as versões atuais do servidor e da função e confirmar o backup do banco. Para reverter, desativar as contas Qualidade, encerrar suas sessões e restaurar o servidor e a função anteriores. As políticas adicionais e o valor permitido `quality` podem permanecer no banco com essas contas desativadas; não afetam os outros perfis. Remover a restrição ampliada somente depois de reclassificar todas as contas Qualidade. A migração é transacional e usa limites de espera por bloqueio e duração.

## Verificação

* 11 testes novos de API: criação via administrador, histórico, relatórios, filtros de exportação, troca de senha e bloqueio de leitura/gravação em outros módulos.
* 5 testes novos de interface: menu, tela inicial, histórico e bloqueio de navegação direta.
* Todos os 17 testes JavaScript passam.
* A suíte Python executa 81 testes: 76 passam e 5 falham. As mesmas 5 falhas foram reproduzidas no commit-base, sem as alterações deste recurso. São verificações antigas de inicialização, cache/PWA e versões de arquivos visuais.
* Migração aplicada em PostgreSQL isolado via PGlite, com estruturas e políticas copiadas por metadados, sem dados reais: 30 verificações SQL aprovadas, incluindo leitura, bloqueio de gravação e conversão de motorista para Qualidade. Essa verificação não substitui a homologação com Supabase Auth e Storage.
* Compilação Python, sintaxe JavaScript e `git diff --check` aprovados.
* A criação real via Supabase Auth e as exportações no aplicativo publicado dependem da publicação conjunta dos três componentes.
