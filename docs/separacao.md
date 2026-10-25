# Separação de instrumentos e bateria por peça · APS Audio Engine (v4.0, branch `feat/aps-separation-drums`)

## Visão geral
| Parte | Arquivos | O que faz |
|---|---|---|
| Interface do separador | `separador.html`, `separador.js` | Escolha do arquivo, verificação do aparelho, limites, progresso, cancelamento, ouvir/baixar cada pista, ZIP, envio à DAW e ao Drum Sampler |
| Motor | `separador-worker.js` | Baixa/armazena o modelo, roda o ONNX Runtime Web (WASM) num Web Worker, bloco a bloco |
| Núcleo (sem DOM) | `aps-sep-core.js` (novo) | Overlap-add em fluxo, PCM/WAV, ZIP, limites por aparelho, métricas. Usado pelo navegador **e** pelos testes em node |
| Bateria por peça | `aps-drum-pieces.js` (novo), `bateria.html` | Detecção de ataques das 11 peças, notas fantasmas, revisão manual, MIDI, recriação com samples |
| Modelo | `models/htdemucs_6s_leve_v2.onnx` (42 MB, servido pelo site) e pesos completos fp16 (136 MB, Hugging Face) | HTDemucs-6s |

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
  * Modo **leve**: `models/htdemucs_6s_leve_v2.onnx` (42 MB), pesos int8 por canal gerados pelo APS (`models/quantizar_pesos_int8.py`, `models/stft_no_grafo.py`), servido pelo próprio site.
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

## v4.1 · Modelo leve v2 (memória menor, mesma saída)
Medições feitas antes de mudar o modelo (onnxruntime 1.21, 1 thread, bloco de 7,8 s):
* Os pesos já eram int8 por canal (40 MB). Depois de carregados, ocupam ~180 MB de RSS. **Não eram eles que dominavam o consumo.**
* O pico de execução era de ~994 MB no nativo. Ele vinha de:
  1. **Matrizes de atenção** do crosstransformer: a atenção sobre 2 688 tokens gera uma matriz de 8×2688×2688 floats (231 MB), duplicada pelo Softmax.
  2. Dezenas de tensores de **63 MB** nas camadas externas do encoder/decoder, proporcionais ao bloco de 7,8 s.
* As matrizes da STFT geradas dentro do grafo (14 tensores de 32 MB) foram testadas como entradas externas, e o pico **não mudou** (1 027 MB). A ideia foi descartada.

Mudança: `models/atencao_em_blocos.py` reescreve as 10 atenções (Q·Kᵀ→Softmax→·V) em blocos de 336 consultas. O resultado é **matematicamente idêntico**: a diferença ficou em 0,0 contra o modelo anterior, e o SNR das pistas é igual até a 2ª casa.

| | leve (v4.0) | leve v2 (v4.1) |
|---|---|---|
| Arquivo | 42,46 MB | 42,49 MB |
| Pico RSS nativo (1 bloco) | 994 MB | 632 MB (−36%) |
| Navegador, acima da página ociosa (mesma sessão, 10 s) | 1 156 MB | 900 MB (−22%) |
| Navegador, pico total do Chromium (10 s / 30 s celular) | 1 602 MB | 1 272 a 1 346 MB |
| Tempo por bloco (nativo / navegador) | 7,1 s / ~16 s | 6,2 s / ~16 s |
| Qualidade (SNR bateria/baixo/voz) | 15,43 / 7,81 / 10,43 dB | idêntica |

O que foi avaliado e **não** foi adotado:
* **Quantização mais agressiva** (int4, uint8 de ativações, fp16): o arquivo já é pequeno e o pico vem das ativações. O WASM do ORT não tem kernels fp16 nem int4 para Conv, então isso não reduziria a memória.
* **Bloco menor**: o grafo exportado tem tamanho fixo (343 980 amostras), e o HTDemucs completa entradas menores até esse tamanho. Para mudar isso seria preciso reexportar em PyTorch e retreinar ou validar, o que **não foi feito**.
* **Modelo menor com licença comercial**: não encontrei nenhum de 6 pistas verificável. Os de 4 pistas não têm guitarra/piano. Nada foi incluído.
* **Dividir as convoluções de 63 MB no tempo**: seria a próxima redução possível, mas exige reescrever o grafo com bordas (receptive field). Não foi feito.

### Aparelho de referência: Realme C75 (informado pelo dono)
Chip Helio G92 Max (2×A75 + 6×A55, Mali-G52 MC2) e 6 ou 8 GB de RAM (a versão não foi confirmada). Android 15, segundo o dono; o de fábrica é o 14. **Nada foi testado no aparelho.**
* O Chrome no Android informa `deviceMemory` arredondado: um aparelho de 6 GB costuma informar 4. Assim, o APS aplica "leve, até 1 min".
* Estimativa (**não medida**): o pico da página fica em ~0,9 GB acima da página ociosa, cabendo no caso conservador de 4 GB úteis ao navegador. O tempo esperado é de 3 a 6× o do desktop, ou seja, ~50 a 100 s por bloco de 7,8 s, ou cerca de 8 a 15 min por minuto de música.
* Os limites de `deviceLimits` **não foram aumentados**: falta medir no celular real.
## v4.1 · Teto de 5 minutos por separação (pedido do dono)
* `MAX_SECONDS=300` em `aps-sep-core.js`: nenhum aparelho separa mais de 5 min por vez. A opção de 10 min foi removida.
* `deviceLimits` agora devolve `maxSeconds` (o teto, 300 s) e `recommendedSeconds`, que é o antigo limite por aparelho: 30 s ou 1 min no celular, 1 a 3 min no computador intermediário e 5 min com 8 GB. Acima do recomendado, a duração aparece marcada com "⚠" e o APS pede confirmação, mostrando o tempo estimado. **O usuário decide.** Com menos de 2 GB de memória o botão continua bloqueado.
* Estimativa de tempo na tela: computador ~2 a 4× a duração da música (medido em desktop de 8 núcleos). Celular ~8 a 15 min por minuto de música, **estimativa não medida**. A referência é o Realme C75 (Helio G92 Max, 6 ou 8 GB; Android 15, segundo o dono), que deve receber "recomendado 1 min, máximo 5 min com aviso".
* Música maior que 5 min: a tela informa a duração e explica que só será usado o trecho de até 5 min a partir de "Começar em". O corte é feito por amostra, sem mudar andamento nem alinhamento. Valores forjados acima de 300 s são recusados.
* Tela ligada: o APS usa a Wake Lock API durante o processamento (quando o navegador suporta) e avisa para deixar a tela ligada e o APS aberto.

## v4.2 · WebGPU experimental (opcional, desligado por padrão)
Resultados medidos nesta máquina: Chromium headless 1.64 com WebGPU via **SwiftShader**, que é uma GPU emulada na CPU. **Não há GPU real aqui, então os tempos abaixo NÃO representam uma GPU de verdade.**
* **onnxruntime-web 1.21** (a versão em uso) com WebGPU: aborta ao criar a sessão (exceção numérica do WASM). Com otimização "basic", dá "Aborted()". Um teste mínimo (Conv 1D + DequantizeLinear) falhou no kernel JSEP com "dilations should be 1D". **Não serve.**
* **onnxruntime-web 1.30.0** (MIT): o WASM e o WebGPU recusavam o grafo por `ConstantOfShape(double)` no iSTFT. `models/sem_double.py` converte os 342 tensores float64 para float32. O resultado é o modelo **leve v3** (`htdemucs_6s_leve_v3.onnx`, 42 491 017 bytes), numericamente igual ao v2 (147 dB, diferença máxima de 6e-8). O v3 também roda no ORT 1.21 com WASM, com o mesmo tempo, e por isso **substitui o v2**: continua sendo um arquivo só.
* No ORT 1.30, o WebGPU roda o grafo inteiro. Só as operações de forma/índice ficam na CPU, como o ORT faz por padrão; nenhum operador ficou sem suporte. Em 1 bloco, a diferença WebGPU × WASM foi de 45,5 dB de SNR (diferença máxima de 2,7e-3). Nas pistas finais de 10 s, o SNR contra as referências ficou **idêntico** ao do WASM até a 2ª casa (bateria 15,43, baixo 7,81, voz 10,43 dB), com lag 0.
* Tempo no SwiftShader: 256 s por bloco, contra 16,5 s no WASM, e pico de 2,1 GB contra 1,3 GB. É muito mais lento porque a "GPU" é emulada. **Ganho real não medido.**
* O modo completo (fp16 do Hugging Face) não roda no ORT 1.30, pelo mesmo `ConstantOfShape(double)`. Por isso o WASM continua no ORT 1.21 e o WebGPU fica só no modo leve.

Implementação: a caixa "⚡ Tentar acelerar com a GPU" (criada por `separador.js`) fica desligada por padrão e só aparece ativa se o navegador tiver `navigator.gpu`. O worker carrega o ORT 1.30 (`ort.webgpu.min.mjs`) e volta **automaticamente** para o WASM 1.21 em qualquer erro: falta de GPU, falha no download da biblioteca, criação da sessão ou erro em qualquer bloco (o bloco é refeito em WASM). A tela mostra "Motor em uso: …" e o resultado informa o motor e se houve troca.
Para o Realme C75 (Mali-G52 MC2, Android 15 informado pelo dono): o Chrome Android oferece WebGPU em GPUs Mali recentes, mas o suporte e o desempenho na G52 **não foram verificados**. É preciso medir no aparelho antes de ligar por padrão.
