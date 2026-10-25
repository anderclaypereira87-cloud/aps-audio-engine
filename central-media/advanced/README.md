# APS Central de Mídia — etapa avançada (branch de desenvolvimento)

Esta pasta contém **estabilização convencional por rastreamento de pontos**.
Não contém modelo de IA, rede neural, detector de pessoa/músico, upscaler
neural nem processamento na nuvem.

## Arquitetura

1. O Worker lê amostras esparsas do vídeo original via `CanvasSink.canvasesAtTimestamps`.
2. Cada amostra é reduzida para 160 px de largura, convertida a tons de cinza
   e comparada com a anterior. São rastreados até 28 pontos de textura por
   comparação, por busca de blocos (SAD), com rejeição dos vetores divergentes
   por consenso de mediana. Pontos em movimento independente tendem a ser
   rejeitados se não dominarem a cena.
3. Os deslocamentos aceitos acumulam uma trajetória da câmera. Uma média
   gaussiana temporal produz a trajetória suave. A diferença gera apenas
   translação e recorte de quadro inteiro — nenhuma deformação localizada.
4. A prévia e o exportador usam o mesmo plano e intensidade (0–100%). O
   recorte automático evita bordas vazias, mas movimentos extremos podem
   ultrapassar o máximo de 1,4×; nesses casos a correção é parcial.
5. O áudio e os timestamps **não** são modificados por estabilização. A
   sincronização continua seguindo `videoTime = offsetSeconds + externalTime/rate`,
   com deslocamento positivo atrasando o áudio.

**Limitações técnicas:** rastreamento por translação global não corrige giro,
perspectiva, rolling shutter, vibração com desfoque excessivo ou objetos móveis
dominantes; pode falhar em cenas lisas/escuras. A prévia estabilizada é ativada
somente após o botão **Analisar tremor do vídeo**; a exportação pode realizar
o mesmo pré-processamento automaticamente. O modo desligado preserva o recorte
original e não gera análise adicional.

## Compatibilidade e medição

- MP4 H.264/AAC e WebM VP9/Opus: verificação prévia por
  `M.canEncodeVideo` / `M.canEncodeAudio`, específica para a resolução.
  **Detecção de suporte não equivale a exportação efetivamente validada.**
- Exportação continua incremental no Worker para OPFS quando disponível;
  fallback em memória permanece limitado. Não são modificados arquivos
  originais.
- Após finalizar, o Worker tenta reabrir o contêiner gerado para medir codec,
  resolução e diferença entre a duração exportada e a original.
- O relatório expõe tamanho real do arquivo, quadros codificados, duração,
  codecs, sincronismo (quando referência existe), cobertura do rastreamento,
  espaço temporário estimado e **estimativa mínima de buffers de canvas**.
  Essa estimativa **não mede RAM total / RSS do navegador**.
- MP4 em Safari/iOS, WebM, 1080p prolongado, 4K e desempenho térmico ainda
  dependem de validação por equipamento real. Não garantimos IA em 4K.

## Testes

```bash
node --test central-media/tests/sync.test.mjs central-media/tests/advanced.test.mjs
python3 central-media/tests/make-fixtures.py /tmp/aps-media-fixtures
APS_TEST_CHROME=/caminho/para/chrome APS_FIXTURES=/tmp/aps-media-fixtures node central-media/tests/browser.cjs
python3 central-media/tests/verify-exports.py /tmp/aps-media-fixtures
```

Os testes Node verificam vetores de translação reais sobre imagens sintéticas,
rejeição de quadros planos, intensidade, suavização, recorte e ausência de
deformação. O teste Playwright acrescenta uma gravação sintética de câmera
tremendo com áudio H.264/AAC de referência. O verificador externo via
FFmpeg/SciPy mede o sincronismo do **arquivo exportado** em 3 pontos, duração,
PTS, codecs e diferença temporal de quadros antes/depois.

> Não tratar testes apenas preparados como executados. Evidências verificadas
> nesta branch devem ser registradas em `test-evidence.json`.

## Roteiro obrigatório em celulares físicos

Para cada Android/Chrome e iPhone/Safari, registrar marca, modelo, OS,
navegador e RAM (se mensurável):

1. Abrir `midia.html`; importar uma gravação própria de 1 minuto com
   movimento de câmera, som de referência e WAV separado.
2. Verificar rastreamento convencional com 0, 50 e 100% de intensidade;
   comparar mãos, instrumento, bordas e quadro 16:9, 9:16, 4:5.
3. Exportar MP4 H.264/AAC e WebM VP9/Opus somente quando `canEncode`
   estiver disponível; abrir os arquivos **baixados** em um player independente.
4. Medir sincronismo real início/meio/fim contra a referência, com limite de
   um quadro conforme taxa de quadros do arquivo; coletar relatório APS.
5. Repetir com 1080p longo (dentro do limite de 10 min) e com 4K se houver
   memória/espaço/suporte; registrar tempo, tamanho, aquecimento, falhas de
   alocação, espaço OPFS e compatibilidade após download.
6. Cancelar durante o rastreamento e novamente durante o render; conferir
   limpeza do arquivo temporário, originais intactos e controles reativados.
7. Repetir com MP3/VBR, áudio adiantado/atrasado e drift; testar enviar WAV
   para DAW. Deixar o recurso de pessoa e IA visual indisponível até
   validação de modelo/versão/licença/pesos e limites de aparelho.
