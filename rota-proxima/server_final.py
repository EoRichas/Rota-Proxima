#!/usr/bin/env python3
"""Entrada final de produção com integridade de relatório e localização."""

import server_hardened as hardened

rota = hardened.rota
_ORIGINAL_COLLECTION_REPORT_ITEMS = rota.collection_report_items


def collection_report_items_without_drafts(token, date_from, date_to):
    """Relatório operacional considera apenas rotas que entraram em operação.

    Rascunhos nunca liberados/iniciados são planejamento, não execução. Excluí-los
    evita que paradas `pending` de uma rota abandonada apareçam como pendência real.
    """
    items = _ORIGINAL_COLLECTION_REPORT_ITEMS(token, date_from, date_to)
    return [item for item in items if item.get('route_status') != 'draft']


rota.collection_report_items = collection_report_items_without_drafts
rota.BUILD_ID = 'STATUS-REPORT-LOCATION-SECURITY-2026-09-15'


if __name__ == '__main__':
    print('[RELATÓRIO] Rotas em rascunho são excluídas das pendências operacionais')
    rota.main()
