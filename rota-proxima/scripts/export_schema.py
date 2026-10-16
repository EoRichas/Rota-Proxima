"""Export an authoritative schema using DATABASE_URL; never synthesize production SQL.

Requires pg_dump compatible with the server's PostgreSQL major version.
The connection string is passed through the subprocess environment, not command args.
"""
import os
import shutil
import subprocess
from pathlib import Path


def main():
    target=Path(__file__).resolve().parents[1]/'supabase'/'baseline.sql'
    if not os.environ.get('DATABASE_URL'):
        raise SystemExit('Defina DATABASE_URL com a conexão do banco Rota Próxima.')
    binary=shutil.which('pg_dump')
    if not binary:
        raise SystemExit('Instale o pg_dump da mesma versão principal do PostgreSQL do projeto.')
    env={**os.environ,'PGDATABASE':os.environ['DATABASE_URL']}
    result=subprocess.run([binary,'--schema-only','--no-owner','--schema=public','--schema=private'],
                          env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        # Do not echo error text that may include a connection string.
        raise SystemExit('Falha ao exportar o schema. Confira conexão, versão e permissões.')
    content=result.stdout.decode()
    if 'CREATE TABLE' not in content or 'CREATE FUNCTION' not in content:
        raise SystemExit('Exportação incompleta: tabelas e funções não foram encontradas.')
    pending=target.with_suffix('.sql.pending')
    pending.write_text('-- Schema autoritativo exportado do projeto Rota Próxima. Sem dados.\n'+content)
    pending.replace(target)
    print(f'Schema exportado: {target.name}. Revise dados sensíveis em defaults e funções antes do commit.')


if __name__=='__main__':
    main()
