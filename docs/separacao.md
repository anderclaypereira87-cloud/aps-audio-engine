# Separação de instrumentos e bateria por peça · APS Audio Engine (v4.0, branch `feat/aps-separation-drums`)

## Visão geral
| Parte | Arquivos | O que faz |
|---|---|---|
| Interface do separador | `separador.html`, `separador.js` | Escolha do arquivo, verificação do aparelho, limites, progresso, cancelamento, ouvir/baixar cada pista, ZIP, envio à DAW e ao Drum Sampler |
| Motor | `separador-worker.js` | Baixa/armazena o modelo, roda o ONNX Runtime Web (WASM) num Web Worker, bloco a bloco |
| Núcleo (sem DOM) | `aps-sep-core.js` (novo) | Overlap-add em fluxo, PCM/WAV, ZIP, limites por aparelho, métricas. Usado pelo navegador **e** pelos testes em node |
| Bateria por peça | `aps-drum-pieces.js` (novo), `bateria.html` | Detecção de ataques das 11 peças, notas fantasmas, revisão manual, MIDI, recriação com samples |
| Modelo | `models/htdemucs_6s_leve.onnx` (42 MB, servido pelo site) e pesos completos fp16 (136 MB, Hugging Face) | HTDemucs-6s |

### Fluxo do separador
1. O arquivo é decodificado no navegador e reamostrado para 44,1 kHz estéreo (não altera andamento/BPM nem duração).
2. O áudio é cortado em blocos de 343 980 amostras (~7,8 s, tamanho fixo do modelo exportado) com **25% de sobreposição**.
3. Cada bloco passa pelo modelo; as 6 saídas são somadas com janela triangular (overlap-add). Só um bloco de acumulação fica em memória (≈16 MB), então o consumo não cresce com a duração.
4. Cada trecho finalizado vira PCM 16 bits e é transferido ao thread principal como Blob; no fim, o WAV é montado com cabeçalho. As 6 pistas começam na amostra 0 e têm exatamente a duração da entrada.
5. O worker mede a soma das 6 pistas contra a mistura e a tela mostra essa verificação.
6. Se qualquer etapa falhar (download, memória, formato, NaN, tempo limite), aparece o erro e **nenhuma pista é criada**.

### O que foi corrigido em relação à versão anterior (auditoria)
| Problema encontrado | Correção |
|---|---|
| O modo usado (`separateStream`) cortava blocos **sem sobreposição**, o que gera emendas a cada 7,8 s | Overlap-add em fluxo (`StreamOLA`) com 25% de sobreposição, sem aumentar a memória |
| Saída mono 22 kHz calculava pares por bloco: com blocos de tamanho ímpar, a última amostra se perdia ou duplicava | `PcmWriter` guarda 1 amostra entre blocos. Duração testada exata |
| Opção padrão "nuvem" chamava o worker de pagamentos → Replicate (sem crédito, não autorizado) | Nuvem desativada na interface e removida do código. Contrato abaixo, desligado |
| Nenhum ZIP | ZIP (store) montado a partir dos Blobs, sem duplicar a memória |
| Cancelar: só `terminate()` | Envia `cancel` e encerra o worker (libera a memória do WASM). Medido: −940 MB de RSS no navegador |
| Limite de aparelho só como aviso | `deviceLimits()` bloqueia o modo/duração além do limite e desliga o botão quando a memória é < 2 GB |
| Erros genéricos | Mensagens distintas para rede, modelo corrompido, memória, formato inválido, NaN e tempo limite |
| Código morto (`separate` em Float32 inteiro, `runCloud`) | Removido |

## Modelos, licenças e hospedagem
* **HTDemucs-6s** (Meta / Facebook Research, repositório `facebookresearch/demucs`), **licença MIT**, que cobre o código e os pesos publicados. A licença MIT permite uso comercial, desde que o aviso de copyright acompanhe as cópias (está em `models/LICENCA_MODELO.txt`).
* **Exportação ONNX**: `StemSplitio/htdemucs-6s-onnx` no Hugging Face, declarada como MIT.
  * Modo **completo**: `htdemucs_6s_fp16weights.onnx` (136 428 532 bytes), baixado do Hugging Face na primeira vez (resposta HTTP 200 verificada em 25/10/2026). Fica hospedado por terceiros: se o arquivo sair do ar, o modo completo para de funcionar. Recomendação: copiar o arquivo para o próprio site antes do lançamento comercial, decisão do dono.
  * Modo **leve**: `models/htdemucs_6s_leve.onnx` (42 MB), pesos int8 por canal gerados pelo APS (`models/quantizar_pesos_int8.py`, `models/stft_no_grafo.py`), servido pelo próprio site.
* Observação honesta: o HTDemucs foi treinado pela Meta com MUSDB18-HQ e dados internos. A licença dos pesos é MIT, mas para um produto comercial recomenda-se uma revisão jurídica da procedência dos dados de treino.
* **Isolamento por peça da bateria (operação A)**: não existe, no APS, modelo de licença comercial verificada que separe bumbo, caixa, pratos etc. Modelos de pesquisa (por exemplo, DrumSep) têm licença ou procedência de dados não verificada. **Nenhum foi incluído.** A interface diz que só a bateria inteira é isolada.

## Dependências
| Dependência | Versão | Origem | Licença |
|---|---|---|---|
| onnxruntime-web | 1.21.0 | cdn.jsdelivr.net (já usada antes) | MIT |
| Modelo leve | – | site APS (`models/`) | MIT (derivado) |
| Modelo completo | – | huggingface.co | MIT |
Os testes usam `onnxruntime-node` 1.21.0 e `playwright` 1.64.0, instalados **fora** do repositório (nenhum `package.json` foi adicionado ao site).

## Custo computacional (medido nesta máquina: 8 vCPU x86, sem GPU)
| Duração | Blocos | Navegador (Chromium headless, WASM 1 thread, modo leve) | Node nativo (onnxruntime-node, 4 threads, mesmo núcleo JS) |
|---|---|---|---|
| 10 s | 2 | 33 s de processamento | 7 s |
| 30 s | 5 | 82 s | 15 s |
| 1 min | 10 | 159 s | 29 s |
| 10 min | 103 | 1 630 s (~27 min), pico de 3,7 GB no navegador | 306 s, pico de RSS de 637 MB |
* No navegador são cerca de 16 s por bloco (≈2,7× o tempo real) num núcleo de desktop. Num celular intermediário, a estimativa é de 3 a 10 vezes mais lento (**não medido em aparelho real**).
* Memória: a soma de todos os processos do Chromium ficou entre 2,3 e 2,5 GB durante a separação (modelo, ORT e a página). O pico mais alto vem do carregamento do modelo, e não da duração.
* Não há custo de servidor: tudo roda no aparelho do usuário. O site só serve 42 MB, uma vez por aparelho, porque o modelo fica no Cache Storage.

## Limites por aparelho (`deviceLimits` em `aps-sep-core.js`)
| Situação | Modos | Duração máxima |
|---|---|---|
| `navigator.deviceMemory` < 2 GB | nenhum (botão desativado e mensagem) | 0 |
| < 4 GB, ou celular sem informação | leve | 30 s no celular, 60 s no computador |
| < 8 GB, ou celular | leve | 1 min no celular, 3 min no computador |
| ≥ 8 GB (desktop) | leve e completo | 10 min |
* Threads WASM exigem `crossOriginIsolated` (cabeçalhos COOP/COEP), que o GitHub Pages não envia. Por isso roda em 1 thread. A tela mostra isso.
* O WebGPU é detectado e exibido, mas **não é usado**: não foi validado com este grafo, que roda com otimização desativada.
* O tempo limite é proporcional: 4 min por bloco, com mínimo de 10 min.

## Bateria por peça (`bateria.html` + `aps-drum-pieces.js`)
* **A · Isolamento neural**: entrega só a bateria inteira (pista "Bateria" do HTDemucs-6s, enviada do separador por IndexedDB). Rotulado na tela.
* **B · Substituição de timbres**: análise por 3 bandas (abaixo de 150 Hz, de 150 Hz a 2 kHz e acima de 6 kHz), com onset adaptativo por banda e agrupamento de ataques simultâneos (por exemplo, bumbo junto com chimbal). A peça é estimada pelo decaimento e pela taxa de cruzamentos por zero. Prato longo repetido é classificado como ride, e isolado como crash ou splash. A intensidade é relativa por peça, sem compressão. Nota fantasma é uma caixa, rimshot ou chimbal abaixo de 40% da mediana da peça. O tempo do ataque fica na amostra do ataque, sem quantização. A grade só se aplica, como opção, ao MIDI.
* Revisão manual: mover (campo de tempo), apagar, adicionar, trocar a peça e a intensidade. A importação de kits WAV/ZIP (com ou sem compressão), as camadas de intensidade, o round-robin e a recriação com samples já existiam e foram mantidos.
* MIDI: formato 0, canal 10, mapa GM (36, 38, 37, 42, 46, 50, 47, 43, 51, 49, 55).

## Integração com a DAW
Não foi preciso alterar `daw.html` nem `aps-daw-pro.js`. O separador usa o canal que já existia: as 6 pistas vão para o IndexedDB `aps-stems-transfer-v1` e a página abre `daw.html?modulo=mixagem&importStems=1`. Lá o usuário toca em "Importar" e as 6 pistas entram no mixer, o que foi testado.

## Nuvem (somente projeto, DESATIVADO)
Contrato proposto, que **não foi implementado nem conectado**:
`POST /separar` (body: WAV 44,1 kHz, `Authorization: Bearer`) → `{id}`; `GET /separar/{id}` → `{status: starting|processing|succeeded|failed}`; `GET /separar/{id}/{drums|bass|other|vocals|guitar|piano}` → WAV. Limites por plano no servidor; o áudio é apagado depois de 24 h. Só deve ser ligado com autorização do dono e um provedor definido.

## Como rodar
```bash
python3 -m http.server 8799                      # na raiz do repositório
# abrir http://127.0.0.1:8799/separador.html
# testes (precisam de: npm i onnxruntime-node@1.21.0 playwright@1.64.0 numa pasta FORA do repo = $ORT_DIR)
node tests/core.test.mjs
python3 tests/make_fixtures.py /tmp/fix 10 30 60 600
python3 tests/make_drum_fixture.py /tmp/fix/drums30.wav /tmp/fix/drums30.json 30
ORT_DIR=$ORT_DIR node tests/node-separate.mjs models/htdemucs_6s_leve.onnx /tmp/fix/mix_60s.wav /tmp/out/n60
python3 tests/analyze_stems.py /tmp/fix/mix_60s.wav /tmp/out/n60 /tmp/fix/ref_60s
node tests/drum-eval.cjs /tmp/fix/drums30.wav /tmp/fix/drums30.json
ORT_DIR=$ORT_DIR FIX=/tmp/fix OUT=/tmp/e2e node tests/e2e-separador.cjs limits drums nomodel badmodel 10 30 30:mobile 60 cancel
```
