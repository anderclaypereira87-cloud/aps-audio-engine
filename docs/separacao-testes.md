# Registro de testes · separação e bateria por peça (25/10/2026, máquina de testes: 8 vCPU, sem GPU, Chromium headless 1.64)

**Importante:** as músicas de teste são **sintéticas**: bateria, baixo de onda quadrada, acordes senoidais ("piano"), dente de serra ("guitarra") e uma "voz" harmônica com vibrato, geradas por `tests/make_fixtures.py` com as pistas de referência conhecidas. Esses números medem sincronismo, integridade e o comportamento do modelo nesses sinais. **Não medem** a qualidade em música real gravada. Nenhum teste rodou em celular real.

## 1. Separação (modelo leve, HTDemucs-6s int8)
| Teste | Navegador (WASM, 1 thread) | Node nativo (mesmo núcleo JS) |
|---|---|---|
| 10 s | ✅ 33 s, 6 WAVs, ZIP íntegro, DAW importou 6 pistas de 10,000 s | ✅ 7 s |
| 30 s estéreo 44,1 kHz | ✅ 82 s, ZIP íntegro, DAW 6/6 | ✅ 15 s |
| 30 s mono 22 kHz ("Celular") | ✅ 80 s, duração de 30,000 s | ✅ |
| 1 min | ✅ 159 s, DAW 6/6 | ✅ 29 s |
| 10 min | ✅ 1 630 s (~27 min), 6 WAVs de 600,000 s, ZIP íntegro, pico de 3,7 GB (todos os processos do Chromium). Em 10 s, a DAW tinha importado 3 das 6 pistas: a importação completa de 6×106 MB **não foi confirmada** | ✅ 306 s, pico de 637 MB |

**Sincronismo** (correlação cruzada entre a soma das pistas e a mistura): lag de **0 amostra** em 10 s, 30 s, 1 min e 10 min (testado no início, no meio e no fim). No modo mono 22 kHz o lag foi de −1 amostra a 44,1 kHz, ou 0,02 ms, efeito da reamostragem da análise. A duração de cada pista é igual à de entrada (diferença de 0,000 s, conferida pelo ffprobe).

**Áudio real nos downloads** (ffprobe: pcm_s16le, 44 100 Hz, estéreo). RMS por pista no caso de 1 min: bateria −26 dBFS, baixo −21, voz −30, outros −47, piano −58, guitarra −69 dBFS. As pistas guitarra e piano ficaram quase vazias: o modelo não reconheceu esses timbres sintéticos.

**Qualidade** (SNR contra a referência sintética, não é SDR do MUSDB): bateria 15,5 dB, baixo 7,8 dB, voz 10,5 dB, guitarra 0,0 dB, piano 0,0 dB (falharam nos sinais sintéticos). Soma das 6 pistas contra a mistura: 17,7 a 17,8 dB. Sem sobreposição (versão antiga), a bateria tem 15,23 dB contra 15,49 dB com overlap-add, e o piano tem −58,7 contra −62,0 dBFS de vazamento. No mono 22 kHz, a SNR da bateria cai para 8,3 dB, porque o modo corta os agudos (é a saída "Celular").

**Cancelamento**: com 1 min em processamento, cancelado durante o bloco 1, a tela mostrou "Cancelado pelo usuário…", o botão Separar voltou a funcionar, não apareceu resultado e a memória do navegador caiu de 2 405 para 1 465 MB em 4 s.

**Falhas**: modelo inacessível ("Sem conexão para baixar o modelo Leve") e modelo corrompido ("Arquivo do modelo incompleto"). Nos dois casos não houve resultado nem pista criada. O estouro real de memória (OOM) **não pôde ser provocado** nesta máquina: o código trata erros de alocação com uma mensagem específica, mas isso não foi verificado na prática.

**Limites por aparelho** (deviceMemory e userAgent simulados): 1 GB deixa o botão desativado com mensagem ⛔. Android com 2 GB fica só no modo leve, até 30 s. Com 8 GB no desktop, leve e completo ficam liberados até 10 min.

**Núcleo** (`tests/core.test.mjs`, 9 testes): o overlap-add reconstrói a entrada com erro abaixo de 1e-5 em 5 durações (inclusive tamanhos ímpares e 61 s). O PcmWriter preserva a duração em blocos ímpares. CRC32 e ZIP foram validados pelo `zipfile.testzip` do Python.

## 2. Bateria por peça (operação B, `tests/drum-eval.cjs`, bateria sintética de 30 s com gabarito de 170 golpes, 11 peças)
* Ataques encontrados (recall): 94,7%. Precisão: 76,7% (49 golpes a mais, sobretudo caixa ou chimbal aberto falsos nos ataques compostos).
* Peça correta entre os golpes encontrados: 87%. Bumbo 33/33, caixa 30/33, rimshot 3/3, chimbal fechado 39/50, chimbal aberto 2/2, tom 1 6/6, tom 2 5/6, surdo 5/7, ride 13/17 (7 rides não foram detectados por causa da sobreposição de decaimentos), crash 3/3, splash 1/1.
* Erro de tempo: mediana de 0,09 ms, p95 de 7,8 ms. Análise de 30 s em 74 ms.
* Notas fantasmas: 18 no gabarito, 24 marcadas (há falsos positivos).
* Interface (Playwright): painel A/B visível, 211 ataques listados, edição de tempo e remoção funcionando, MIDI exportado (cabeçalho "MThd"). A leitura de ZIP de kit (store + deflate) foi testada.

## 3. Não resolvido / não verificado
* Nenhum teste em música real nem em celular real. A qualidade em gravações reais precisa ser ouvida pelo dono.
* O modo **completo** (136 MB, Hugging Face) não foi executado nos testes. Só o download foi conferido (HTTP 200).
* OOM real não foi provocado. WebGPU e threads WASM não foram usados.
* Com 10 min no navegador: ~27 min de processamento e 3,7 GB de pico. Não é viável em celular, e por isso o limite fica em 30 s a 1 min.
* A importação de 6 pistas de 10 min na DAW não teve a conclusão confirmada.
* O isolamento neural por peça da bateria (operação A) não existe: falta um modelo com licença comercial.
* A classificação de peças é heurística e foi medida só em bateria sintética. Em gravações reais, espere mais erros: a revisão manual é obrigatória.

## v4.1 (leve v2, atenção em blocos), 25/10/2026
* `node tests/core.test.mjs`: 9 de 9 testes ok.
* Navegador, 10 s: 33 s, 6 WAVs, ZIP íntegro, DAW 6/6, lag 0 e SNR idêntico ao v4.0. Pico do Chromium de 1 272 MB (514 MB com a página ociosa).
* Navegador, 30 s no modo celular: 81 s, DAW 6/6, lag de −1 amostra (reamostragem) e SNR idêntico. Pico de 1 308 MB.
* Cancelar: a memória caiu de 1 305 para 636 MB. Modelo corrompido: aparece o erro e nenhuma pista é criada.
* Na comparação A/B, na mesma sessão, o pico acima da página ociosa foi de 1 156 MB no v4.0 e de 900 MB no v2.
* A bateria por peça não muda: o modelo não foi alterado, só a ordem dos cálculos.
* Não foi testado: celular real (Realme C75 ou outro), 1 e 10 min com o v2 (o algoritmo de blocos é o mesmo do v4.0) e o modo completo.
## v4.1 · Teto de 5 min (25/10/2026)
* `node tests/core.test.mjs`: 9 de 9 testes ok. O teste de limites confere que o teto é 300 s em todas as combinações e que o recomendado é 30 ou 60 s no celular.
* Navegador, limites: com 1 GB, bloqueado. Android com 2 GB: recomendado 30 s, opções até 300 s. Desktop com 8 GB: até 300 s. A opção de 600 s não existe mais.
* Navegador, música de 10 min (`longo`): aparece o aviso "Esta música tem 10 min… trecho de até 5 min". Uma duração forjada de 600 s foi recusada. O trecho de 590 a 600 s foi separado com 10,000 s de saída, e a soma das pistas bate com o trecho original (18,6 dB, o que confirma o alinhamento).
* Navegador, 10 s: 34 s, ZIP íntegro, 6 pistas na DAW, lag 0 e 17,85 dB (igual ao anterior).
* Não testado: uma separação completa de 5 min com este código (em v4.0, 10 min funcionaram no desktop) e qualquer teste em celular real.
