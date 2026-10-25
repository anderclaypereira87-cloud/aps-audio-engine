# APS Central de Mídia — sincronização de clipes curtos

## Problema observado

Vídeo e áudio externos de aproximadamente 2 segundos não eram sincronizados.
O algoritmo anterior rejeitava qualquer envelope menor que 2,000 segundos
e exigia 3 janelas de correlação. Vídeos com 1,9 s e clipes com poucos eventos
sonoros chegavam ao fallback manual mesmo quando o deslocamento era identificável.

## Alteração

- Até 3,5 segundos: correlação global com sobreposição mínima de 58%,
  confiança mínima de 0,78 e destaque do melhor pico de pelo menos 0,075.
  O deslocamento também precisa manter correlação de pelo menos 0,55 nas
  metades inicial e final; som silencioso, diferente ou muito repetitivo é
  recusado sem inventar um alinhamento.
- A partir de 3,5 segundos: o algoritmo anterior de múltiplas janelas,
  regressão de velocidade e detecção de drift permanece inalterado.
- Em clipes curtos, a velocidade continua 1x: não há dados suficientes para
  estimar um drift temporal confiável. A resolução de deslocamento permanece
  5 ms. A convenção de sinais não mudou: deslocamento positivo atrasa o áudio.
- Menos de 0,75 segundo ou ausência de som legível no vídeo: ajuste manual;
  nenhum áudio gerado ou substituição da execução.

## Evidência executada

Em 25/10/2026, `node --test central-media/tests/sync.test.mjs
central-media/tests/advanced.test.mjs central-media/tests/framing.test.mjs`
aprovou **34/34 testes**, incluindo clipes sintéticos de 0,95, 1,85, 2,03 e
3,1 segundos com deslocamentos de −200, 0 e +200 ms, recusa de sinais
silenciosos, desconexos e repetitivos e regressão de clipes longos com drift.

**Pendente:** testar sincronização e exportação com os dois arquivos reais do
usuário no Android/iPhone. O navegador Chromium local não iniciou por restrição
de `socket()` neste ambiente. A correlação sintética não prova qualidade da
exportação com o codec específico do arquivo enviado.

## Teste manual

1. Selecione vídeo com áudio original audível e o áudio externo da mesma
   execução (entre 1 e 3 segundos, por exemplo).
2. Toque **Sincronizar automaticamente**. Espera-se a mensagem **Trecho curto
   alinhado**, com o deslocamento estimado; se o som não for comparável, a
   ferramenta deve explicar a recusa em vez de aplicar alinhamento errado.
3. Confira a prévia e exporte. Reproduza o arquivo final e verifique o
   sincronismo dos ataques no início e no fim; o relatório registra a medição
   por correlação quando a referência for confiável.
