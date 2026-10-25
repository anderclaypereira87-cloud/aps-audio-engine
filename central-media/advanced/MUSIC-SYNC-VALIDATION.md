# Sincronização musical avançada (experimental)

Escopo da issue #17. Esta implementação é **análise espectral determinística**
(STFT/chroma de 12 classes), **não** um modelo neural ou IA generativa.
Executa localmente; não publica o material do usuário nem requer serviço pago.

## Implementação

- Análise incremental de notas/acordes da gravação do vídeo e do áudio externo;
  busca de até ±600 segundos, correspondências em janelas independentes e
  verificação robusta de deslocamento e razão temporal entre **0,90 e 1,10**.
- Somente quando o sincronizador de transientes não aceita o material e há
  gravação suficiente, executa a análise de chroma. Silêncio, trechos curtos ou
  evidência fraca não geram correção automática.
- A convenção permanece `videoTime = offsetSeconds + externalTime / rate`.
  A detecção de drift não o aplica sem marcar a opção explicitamente.
- Até ±0,5% a exportação mantém o motor anterior. Acima de ±0,5% e até ±10%,
  o áudio utiliza WSOLA (sobreposição de segmentos por semelhança de forma de
  onda) em vez de alterar a taxa de reprodução; não sintetiza notas.
- A prévia solicita preservação de pitch no elemento de áudio. Safari e outros
  navegadores devem ser validados em aparelho físico.
- Se a verificação final só conseguir reconhecer a música por chroma, o site
  **não diz** que houve sincronismo dentro de um quadro; essa análise tem
  resolução de 150 ms. A verificação original por transientes permanece para
  os casos que forneçam prova mais fina.

## Testes executados

`node --test central-media/tests/sync.test.mjs central-media/tests/music-fingerprint.test.mjs central-media/tests/pitch-preserving-tempo.test.mjs central-media/tests/advanced.test.mjs central-media/tests/framing.test.mjs`

51 testes passaram no ambiente de desenvolvimento, incluindo alterações de
andamento de −10%, +10% e 3,8%, sons diferentes, silêncio e notas senoidais
com verificação aproximada de pitch 440 Hz após WSOLA. Esses testes não são
evidência de exportação WebM/MP4 em iPhone/Android físicos.

### Diagnóstico em gravações reais fornecidas pelo proprietário

Medido localmente com FFmpeg para decodificação a mono/8 kHz, sem upload:

| Medição | Resultado aproximado |
|---|---:|
| Duração de vídeo | 126,1 s |
| Duração do áudio externo | 129,4 s |
| Razão temporal encontrada | 1,038012 (+3,8012%) |
| Deslocamento pelo modelo | +1,540 s |
| Trechos musicais concordantes | 12 |
| Confiança mediana | 0,898 |
| Resíduo máximo do modelo chroma | 62,3 ms |

Esses dados mostram **localização do mesmo material musical**, não que uma
exportação corrigida foi produzida ou verificada. A resolução da análise de
chroma é 150 ms. A meta de ≤1 quadro depende de um teste independente do
arquivo exportado, em início, meio e fim.

## Pendências antes da publicação de produção

1. Exportar uma amostra real em MP4/AAC e WebM/Opus e medir quadro a quadro,
   inclusive em drift ±10%. Avaliar artefatos de WSOLA em bateria/transientes.
2. Testar Android e iPhone **físicos**, desempenho, áudio externo da prévia,
   queda de quadros, aquecimento, cancelamento e memória com até 10 minutos.
3. Confirmar codecs disponíveis por aparelho e falta de áudio de referência;
   não prometer correção perfeita em cortes não lineares/execuções diferentes.
4. Integrar a branch após revisar conflitos com o trabalho paralelo da Central
   de Mídia; preservar a `main` publicada até homologação.
