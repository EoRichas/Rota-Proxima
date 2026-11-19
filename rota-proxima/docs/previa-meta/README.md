# Coleta da Meta Reciclagem

Ao abrir **Solicitações → Nova solicitação** e escolher a Meta Reciclagem, o Comercial informa o CEP, a rua e o número da coleta. A partir de **PEVs / Locais → Solicitar**, o formulário já abre com essa PEV selecionada. Para as demais PEVs, o formulário continua usando o endereço do cadastro.

Cada solicitação tem seu próprio endereço. Se houver dois locais da Meta na mesma rota, cada um aparece como uma parada, com seu horário, prioridade e atendimento. O motorista recebe o endereço da respectiva parada para abrir o Google Maps ou o Waze.

**Publicação:** aplicar primeiro a migração incremental `20261119171426_meta_pickup_address.sql` no banco correto e publicar a aplicação na mesma janela. Entre a migração e a nova versão, o formulário antigo não consegue criar solicitações da Meta sem endereço. Solicitações e rotas anteriores à mudança continuam usando o endereço do cadastro. Nenhum endereço anterior é inferido.
