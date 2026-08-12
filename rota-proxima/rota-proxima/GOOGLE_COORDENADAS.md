# Coordenadas das PEVs via Google

Esta versão adiciona somente a integração de coordenadas com a Google Geocoding API.

## Render
Adicione uma variável de ambiente:

- `GOOGLE_MAPS_API_KEY` = sua chave da Google Maps Platform com **Geocoding API** habilitada.

Não coloque a chave no código ou no GitHub.

Depois do deploy, entre como Administrador em **PEVs / Locais** e clique em **Atualizar coordenadas Google**.
O sistema recalcula todas as PEVs ativas e grava `lat`/`lng` no Supabase.
Resultados `ROOFTOP` são marcados como localização confirmada automaticamente; outros resultados recebem coordenadas mas permanecem como não confirmados.

Nenhuma migration SQL é necessária para esta alteração.
