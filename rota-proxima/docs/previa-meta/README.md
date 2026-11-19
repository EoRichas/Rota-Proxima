# Coleta da Meta Reciclagem

No formulário do Comercial, o CEP preenche a rua e mostra a referência geográfica disponível. O Comercial confere a rua e informa o número. Um CEP genérico permite digitar a rua. O destino da parada vem da solicitação; o sistema calcula as coordenadas no planejamento, e a navegação usa o endereço completo para não tratar o centro do CEP como a entrada do imóvel.

Em **Locais já visitados**, o Comercial pode reutilizar endereços de visitas da sua carteira. O motorista consulta visitas das próprias rotas em **Histórico**, inclusive sem rota ativa. São exibidos até 30 locais distintos, por visita mais recente. Se uma visita antiga registrou apenas GPS de chegada, é possível ver o ponto, mas não reutilizar um endereço presumido.

A Meta só entra no planejamento por solicitação com endereço e sempre como coleta. Cada solicitação é uma parada independente. O motorista precisa da foto do local; não há entrega, instalação nem foto de tambor. As demais PEVs mantêm as regras anteriores.

**Publicação:** aplicar a migração do PR, `20261119171426_meta_pickup_address.sql`, antes do novo código, na mesma janela. Entre as etapas, o formulário antigo não cria solicitações da Meta sem endereço. Solicitações pendentes anteriores sem endereço precisam ser refeitas pelo Comercial. Uma parada antiga sem endereço solicitado nunca mostra a sede como destino.
