# Central de Mídia — sincronização audiovisual local

Versão experimental desenvolvida na branch `feat/aps-media-sync` e entregue no PR #5. O proprietário autorizou a integração e publicação no site existente em 25/10/2026 para testes. As limitações de homologação abaixo continuam válidas. Sem novo projeto, banco, API paga ou processamento em nuvem.

## Base analisada

`main` em `69c8f292fd35c52fdbfdab9b70438b1486e9a170`. A Central existente importava vários arquivos, verificava duração de até 600 s, reproduzia conforme os codecs do navegador, baixava originais e transferia um `File` para a DAW via IndexedDB. Esse fluxo foi preservado abaixo do editor. Não havia correlação, compositor audiovisual nem exportação sincronizada.

Somente `midia.html`, os novos `aps-video-sync.js` / `aps-video-enhance.js` e arquivos novos em `central-media/` pertencem a esta mudança. Nenhum arquivo das outras frentes foi editado.

## Implementado

- Seleção independente de vídeo e áudio, metadados reais, limite de 10 minutos / 768 MB por arquivo.
- Decodificação incremental por WebCodecs / Mediabunny, com cache de entrada limitado; não carrega todo o PCM em memória.
- Envelope de energia e transientes a 200 Hz. Correlação cruzada normalizada por FFT em 3 ou 7 janelas, busca de até ±30 s. Verificação de energia, ambiguidade, concordância dos marcadores e regressão robusta de drift. Sem IA generativa ou resultados simulados.
- Deslocamento automático somente com evidência suficiente. Drift linear até ±0,5% é medido; aplicar sua correção exige ativar o controle explícito. Sinais silenciosos, repetitivos, inconsistentes ou diferentes não recebem um ajuste inventado.
- Calibração do atraso do player MP3 por correlação entre um prefixo decodificado pelo navegador e o áudio do motor. Se não houver evidência suficiente, a prévia externa MP3 fica pausada e pede conferência da exportação ou WAV.
- Microajustes de 1 ms / um quadro, forma de onda de energia com marcadores, reprodução comparativa original/edição e sincronização da prévia por relógios de mídia. A prévia pode diferir alguns milissegundos; não é usada como prova do arquivo final.
- Processamento de áudio determinístico: ganho, EQ de 3 bandas, passa-altas, passa-baixas para chiado, atenuação leve das pausas e compressor estéreo vinculado 2:1 (ataque 20 ms). Todos começam neutros. Relatório de amostras limitadas em 0 dBFS. Não há substituição de notas ou acordes.
- Correções convencionais SDR: exposição, contraste, saturação, temperatura/tint, redução espacial de ruído de quatro vizinhos, nitidez, zoom e recorte manual do enquadramento.
- Formatos original, 16:9, 9:16 e 4:5; presets 1080p e 4K mediante capacidade do codificador. Ex.: 1080×1920 vertical e 1080×1350 em 4:5. Ampliação não recupera detalhes ausentes.
- Exportação em Worker, sem gravar a tela em tempo real. Mantém os timestamps/durações dos quadros, intercala áudio e vídeo e respeita backpressure. Saída MP4 H.264/AAC quando disponível ou WebM VP9/Opus. Áudio original pode ser substituído, mantido ou removido.
- WAV PCM 16-bit a 48 kHz editado/alinhado para a DAW, usando o contrato já existente. Se a transferência falhar, o WAV continua disponível para download.
- Progresso de leitura/correlação/quadros realmente processados/finalização e verificação. Cancelamento cooperativo, encerramento forçado após 4 s se necessário e limpeza de temporários.
- Saída incremental em OPFS quando disponível. Fallback de memória limitado a 96 MB, com recusa de tarefas grandes. O arquivo final e relatório JSON podem ser baixados; os originais não são sobrescritos.
- Quando há referência confiável, decodifica o áudio do arquivo exportado e mede novamente o alinhamento. O limite estimado exibido inclui a resolução de análise de 5 ms. Sem referência, o arquivo fica explicitamente sem verificação automática.

## Convenção de tempo

`videoTime = offsetSeconds + externalTime / rate`. Deslocamento positivo atrasa o áudio; negativo adianta. Uma gravação externa que contém 250 ms extras de silêncio recebe `offsetSeconds = -0.25`.

O início do vídeo é rebaseado a zero; o áudio original considera seu timestamp relativo a esse início. Partes fora do áudio externo são preenchidas com silêncio; sua sobra é cortada na duração do vídeo. A compensação de drift usa interpolação linear e pode alterar discretamente a afinação. Não há quantização ou mudança de execução independente do alinhamento solicitado.

## Limitações e produção

- Estabilização, rastreamento automático do músico, redução temporal de ruído, reconstrução por modelos de IA e processamento em nuvem ainda não estão implementados. A interface identifica isso.
- Vídeo HDR é recusado para impedir correção de cor sem um fluxo de tone mapping validado. Esta etapa trabalha em SDR.
- Mono/estéreo apenas; codecs dependem do aparelho. Arquivo selecionável não significa decodificação/codificação garantida. AVI/WMA e outros formatos da biblioteca anterior podem exigir conversão externa.
- Correlação não comprova sincronismo labial/acústico absoluto de uma gravação feita à distância; alinha a referência disponível. Referências com cortes, execuções diferentes, silêncio, grandes trechos repetidos ou desvio não linear exigem ajuste manual.
- Nitidez/ruído usam vizinhos em pixels; a prévia reduzida não substitui a inspeção da saída em tamanho real. Correções CPU em 1080p/4K podem ser lentas e aquecer celulares. Mantenha a aba aberta.
- 4K, MP4/AAC, Android físico e iPhone/iOS precisam de homologação no equipamento real. A emulação Android verifica interface, não desempenho nem codecs do telefone.
- O teste de 9min50s usa vídeo 160×90 a 10 fps, para verificar duração e clocks. Ele não valida 10 minutos em 1080p/4K. O teste 1080p é separado e curto.
- O fallback de memória, falta de espaço OPFS e interrupção pelo sistema operacional precisam de mais testes de estresse antes de produção. Em um fechamento abrupto podem sobrar temporários locais; não há envio a servidores.
- A estimativa por correlação na saída não deve ser apresentada como garantia para qualquer arquivo, codec ou fps. Verificar o relatório e ouvir início/meio/final.

Para produção: homologar aparelhos/formatos reais, fazer testes prolongados em 1080p/4K com medição de memória/temperatura, ampliar fixtures musicais gravadas por microfone, validar licença/redistribuição das dependências no produto e testar acessibilidade com leitor de tela. Infraestrutura, Supabase, nuvem, monetização e publicação dependem da frente responsável e da autorização do proprietário.

## Testes reproduzíveis

1. `node --test central-media/tests/sync.test.mjs`
2. `python central-media/tests/make-fixtures.py /tmp/aps-media-fixtures`
3. `APS_TEST_CHROME=/caminho/chrome APS_FIXTURES=/tmp/aps-media-fixtures node central-media/tests/browser.cjs`
4. `python central-media/tests/verify-exports.py /tmp/aps-media-fixtures`

Requer Node, Playwright, Python com NumPy/SciPy e FFmpeg/FFprobe. Nada disso é dependência do site. As fixtures são sintetizadas com semente fixa somente para testar, nunca para substituir áudio do usuário. Os arquivos de teste e exportações ficam fora do repositório; as evidências resumidas são versionadas em `docs/`.

O teste de navegador cria um servidor HTTP apenas em loopback, sem publicação. A DAW é substituída por uma página vazia no teste de transferência para evitar inicializar integrações externas. O contrato real de importação foi conferido no código existente.

## Referências técnicas

- [Mediabunny: leitura](https://mediabunny.dev/guide/reading-media-files), [sinks](https://mediabunny.dev/guide/media-sinks), [escrita/targets](https://mediabunny.dev/guide/writing-media-files) e [sources/backpressure](https://mediabunny.dev/guide/media-sources).
- [MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) e [especificação W3C](https://www.w3.org/TR/webcodecs/).
- Dependência local e licença: [vendor/README.md](vendor/README.md).
