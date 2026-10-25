# Evidências de validação — 25/10/2026

Código da funcionalidade: `e17def9e78797aef71b50117706fa6c339278db2`. Base original: `69c8f292fd35c52fdbfdab9b70438b1486e9a170`.

12 testes unitários passaram. 12 cenários no navegador passaram, além da interface e da transferência WAV para a DAW. Nenhum erro JavaScript de página foi registrado. Os resultados abaixo foram medidos em arquivos realmente exportados pelo código do navegador, e não no player da prévia.

## Exportação: verificação independente

Chrome Headless Shell 135.0.7049.84 em Linux, via Playwright e servidor HTTP de loopback. Exportações WebM VP9/Opus foram abertas novamente por FFmpeg; o sincronismo foi calculado com SciPy sobre envelopes RMS de 1 ms no início, meio e final. Os quadros e timestamps foram lidos por FFprobe.

| Caso | Resolução | Quadros | Erro início / meio / fim (ms) | Máximo | Um quadro |
|---|---:|---:|---|---:|---:|
| 250ms | 320×180 | 480 | [0, 0, 0] | 0 ms | 33.33 ms |
| 1s | 320×180 | 480 | [0, 0, 0] | 0 ms | 33.33 ms |
| silence | 320×180 | 480 | [0, 0, 0] | 0 ms | 33.33 ms |
| advance | 320×180 | 480 | [0, 0, 0] | 0 ms | 33.33 ms |
| mp3 | 320×180 | 480 | [-1, -1, -1] | 1 ms | 33.33 ms |
| original | 320×180 | 480 | [0, 0, 0] | 0 ms | 33.33 ms |
| no-reference | 320×180 | 480 | [0, 0, 0] | 0 ms | 33.33 ms |
| 1080p | 1920×1080 | 60 | [0, 0, 0] | 0 ms | 33.33 ms |
| drift-590s | 160×90 | 5900 | [-1, 0, 1] | 1 ms | 100.00 ms |

- `no-reference`: ausência da faixa de referência foi detectada; a exportação usou o ajuste manual conhecido de −250 ms. Esse caso não comprova sincronização automática sem referência.
- `drift-590s`: duração de 9min50s, drift conhecido de +1000 ppm. Estimativa do motor: +996,56 ppm; compensação ativada no teste. 5.900 quadros preservados, erro máximo independente de 1 ms. Arquivo: 26.795.676 bytes. Vídeo de teste reduzido a 160×90 / 10 fps; não representa carga de 10 minutos em 1080p.
- `1080p`: exportação 1920×1080, 60 quadros, com exposição, nitidez e redução de ruído aplicadas. 1.282.306 bytes. Teste curto de 2 segundos.
- MP3 foi testado com atraso de encoder presente. O alinhamento usou os dados reais; a prévia nativa foi calibrada separadamente por correlação (−70 ms nesta fixture). Erro de exportação: 1 ms.
- Áudio original preservado e saída totalmente silenciosa foram testados. A saída silenciosa escolheu MP4/H.264 sem faixa de áudio; MP4 com AAC não estava disponível neste ambiente.
- WAV final: PCM signed 16-bit, 48 kHz, mono, 1.536.044 bytes para 16 s. Ganho/filtro foram processados; a ponte recebeu um `File` WAV com cabeçalho `RIFF` e navegou para a URL existente da DAW.
- Cancelamento real do Worker durante a codificação foi observado como `cancelled`. Silêncio, sinais diferentes e repetitivos são recusados nos testes unitários.

## Interface e compatibilidade

Seleção → correlação → prévia → exportação → download/relatório e WAV para a DAW foram exercitados. A prévia WAV ficou alinhada nos relógios do player; o arquivo exportado também foi reproduzido pelo player da página. Um problema de overflow no input oculto da biblioteca antiga foi corrigido dentro da Central.

Computador: viewport 1365×1000. Tela móvel: 393×851, sem rolagem horizontal. Emulação Pixel 7 / Android via Playwright: layout sem overflow. Essa emulação usa o mesmo motor desktop e um user-agent configurado; **não é homologação de codecs ou memória de Android físico**.

[Interface no computador](desktop.webp) · [Interface móvel](mobile.webp) · [Dados e hashes](test-evidence.json)

### iPhone / iOS

Não houve aparelho iPhone disponível para o teste. A aplicação consulta codecs/codificadores em tempo de execução; Safari/iOS pode limitar WebCodecs, AudioWorklet, OffscreenCanvas, espaço OPFS e execução em segundo plano. Homologar abertura de MOV/HEVC, reprodução por gesto, exportação, download e memória em aparelhos físicos antes de produção.

## Memória e limites

Ensaio isolado de 590 s com exportação incremental em OPFS, sem extração de arquivo por base64: máximo RSS individual reportado por Linux `RUSAGE_CHILDREN` de **473,504 KiB (~462.4 MiB)** na árvore do teste. É uma medição de processo do ambiente de testes, não soma de RAM nem medição de telefone. Tempo observado nesse ensaio: 8,49 s. Não usar esse tempo como promessa de desempenho.

A coleta de arquivos no harness usa base64 via DevTools e aumenta bastante a memória do teste completo; essa etapa não existe no fluxo de download do usuário. O valor arredondado de `performance.memory` da página não inclui todos os recursos nativos/Workers e não foi usado como medida total.

Ainda falta medir picos e temperatura com música real, 1080p/4K prolongado e vários arquivos em Android e iPhone, testar esgotamento de espaço e interrupção forçada pelo sistema. 4K, estabilização e restauração de detalhes por IA não estão homologados; estabilização e IA visual não foram implementadas. A versão permanece Draft, sem publicação.
