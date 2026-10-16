# Banco e migrações

O projeto Rota Próxima não está entre os projetos disponíveis nas conexões Supabase desta sessão. Por isso **não foi possível obter um dump autoritativo das tabelas e funções anteriores a agosto/2026**. Não existe baseline inventada ou migração de substituição dessas funções.

A migração `20261016183641_route_precision_drum_inventory_and_durable_evidence_sync.sql` é incremental: adiciona situação de tambor, reordenação e fila persistente. Aplicar primeiro em uma cópia do banco real; não foi aplicada em produção nesta PR.

Para fechar a lacuna histórica, forneça `DATABASE_URL` no ambiente local seguro e execute `python scripts/export_schema.py` com `pg_dump` compatível. O arquivo `supabase/baseline.sql` conterá tabelas, funções, policies e grants dos schemas `public` e `private`, sem dados ou senhas. Revise e versione o arquivo. Ele representa o schema atual: não reaplique as migrações anteriores sobre ele.

As policies customizadas de `storage.objects` estão nas migrações do repositório. A infraestrutura gerenciada de `auth`/`storage`, configuração de Auth, funções Edge, secrets e objetos de arquivo devem ser provisionados separadamente no Supabase. Para recuperação de desastre utilize também o backup nativo do provedor; o ZIP da aplicação é um backup operacional.

Depois de ter acesso ao projeto correto:

1. Exporte e versione o schema autoritativo.
2. Restaure em um projeto de homologação vazio com Auth/Storage provisionados.
3. Confira as RPCs `current_profile`, `save_pev`, `create_route_atomic`, `update_stop_atomic`, `apply_stop_reorder`, `dashboard_summary`, `delete_route_atomic`, `delete_user_force`.
4. Aplique a nova migração, valide as policies com cada perfil e teste criação, entrega, coleta, pesagem, reordenação e backup.
5. Só depois aplique em produção e publique o código correspondente.

Não use o baseline em um banco existente. Novas migrações devem seguir o histórico real de cada ambiente.
