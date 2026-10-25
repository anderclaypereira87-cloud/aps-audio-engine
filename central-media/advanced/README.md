# APS Central de Mídia — etapa avançada (branch de desenvolvimento)

Esta pasta contém **estabilização convencional por rastreamento de pontos** e
**enquadramento opcional de uma pessoa por MediaPipe Pose Landmarker Lite**.
O primeiro é convencional; o segundo executa inferência neural no navegador,
quando suportado. Não há detector do contorno de instrumentos, upscaler
neural nem processamento de arquivos na nuvem.

## Enquadramento neural opcional (experimental)

- Clique **Detectar pessoa no vídeo** para buscar um único corpo em amostras
  de até 1 quadro/segundo. O Worker baixa, quando necessário, o runtime
  `@mediapipe/tasks-vision@1.1.1` de jsDelivr e os pesos `Pose Landmarker
  Lite float16/1` do repositório público Google.
- Model card do BlazePose GHUM: Apache-2.0. URLs e identificação estão
  fixadas em `pose-scan.js`; consulte `MODEL-EVALUATION.md`.
- Os marcos do corpo incluem pulsos e mãos. O recorte recebe margem de
  segurança e trajetória suavizada, porém **não detecta todo o baixo, guitarra,
  bateria ou microfone**. Confira bordas, mão e instrumento, particularmente
  em 9:16, e use os controles manuais de zoom, horizontal e vertical.
- O modo vem desligado. Se não houver modelo, internet, RAM ou detecções
  confiáveis, o APS oferece recorte manual. A exportação executa a mesma
  análise quando a caixa é ativada, mesmo sem análise prévia na interface.
- A inferência real, os pesos e o uso em Android/iOS físicos ainda precisam
  de homologação; o código está marcado **experimental** e sem garantia de
  desempenho móvel. Um teste de lógica não valida o modelo no aparelho.

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
node --test central-media/tests/sync.test.mjs central-media/tests/advanced.test.mjs central-media/tests/framing.test.mjs
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
   para DAW. Verificar a detecção de pessoa ativada e desligada, os pontos de
   perda de rastreamento, o recorte com baixo/violão e o ajuste manual.
   Não anunciar melhoria neural da imagem: ela não está implementada.
