# DAW APS — áudio da Central de Mídia, interface USB e latência (issue #16)

## O que mudou
Arquivos: `daw.html` (3 pontos) e o módulo novo `aps-daw-io.js` (exclusivo da DAW). Testes: `tests/daw-io.test.mjs`, `tests/e2e-daw-media.cjs`.
Nada em `midia.html`, `central-media/**`, `index.html`, `aps-tour.js`, separador, bateria, pagamentos, auth ou Supabase. `sw.js` **não** foi alterado: antes de publicar, é preciso incluir `aps-daw-io.js` na lista `FILES` e subir a versão do cache (senão o modo offline não terá o módulo; online funciona pelo `?v=1`).

### 1. Recepção da Central de Mídia
Contrato inalterado: IndexedDB `aps-media-transfer` v1, store `files`, chave `next`, valor `{file, created}`, URL `daw.html?modulo=gravacao&importar=midia`, evento `aps:import-media-file`.
- WAV/áudio: decodificado pelo navegador e inserido como pista **“Central de Mídia · nome”** começando em **0 s**, sem corte, sem mudança de velocidade, sem síntese ou substituição de notas/acordes. A duração do cabeçalho WAV é comparada com a decodificada; se diferirem mais de 2 ms o aviso aparece.
- Vídeo: segue o caminho já existente (`importFiles`: vídeo de referência + extração de áudio quando o navegador suporta).
- Codec não suportado: mensagem clara (“O navegador não conseguiu ler este áudio (tipo)… exporte em WAV na Central”), nenhuma pista é criada.
- A DAW **não** tem gravador de câmera; a câmera continua só na Central de Mídia.

### 2. Interface de áudio / microfone
Painel “🎚 Interface de áudio, permissão e latência” sob “Gravação e afinador”:
- permissão do microfone (`navigator.permissions`, quando o navegador informa);
- entradas encontradas (`enumerateDevices`, atualiza em `devicechange`); a escolha continua no seletor existente `#micDevice` (getUserMedia com eco/ruído/ganho automático desligados);
- monitoramento: a entrada **não** vai aos alto-falantes (só medidor). Para ouvir a base, fone de ouvido;
- “Latência informada”: `baseLatency`/`outputLatency` do navegador — rotulado como estimativa incompleta.

### 3. Medição de latência (laço)
Toca 6 cliques de 1 kHz (30 ms, a cada 0,5 s) e grava a entrada escolhida no mesmo AudioContext. Para cada clique, procura o primeiro ponto acima do limiar (máx(ruído×6, 30% do pico)) até 600 ms depois. Resultado = mediana. **Confiável** só se ≥60% dos cliques forem achados e a variação ≤ 5 ms; caso contrário nada é aplicado. O valor confiável é salvo em `localStorage['aps-daw-latency-v1']`.
Compensação: opcional (caixa “Compensar atraso nas novas tomadas”, desligada por padrão). Corta do início da tomada as amostras do atraso, adiantando o áudio; o som não é alterado. Observação: o WAV “gravação original” baixado após a tomada já sai com esse corte quando a compensação está ligada.
Limites: alto-falante + microfone mede também o tempo do som no ar (~3 ms por metro); Bluetooth costuma ter atraso grande e variável — evite para gravar. Não existe latência zero.

## Testes feitos (Chromium headless, caixa Linux, sem hardware real)
- `node tests/daw-io.test.mjs`: 9/9 (WAV, codec, estimativa 23 ms e 180 ms com ruído, silêncio → nada, variação → não confiável, compensação).
- `ORT_DIR=/workspace/sep-node node tests/e2e-daw-media.cjs`: WAV 3,25 s via IndexedDB → 1 pista, 3,250 s, início 0, chave `next` removida; arquivo `audio/mp4` inválido → 0 pistas e mensagem de codec; painel lista 3 entradas falsas do Chromium; a medição com o microfone falso (que toca bipes próprios, não ouve a saída) foi corretamente marcada NÃO confiável e não aplicada; tomada real de ~1,4 s com o microfone falso: com 100 ms de compensação saiu ~0,11 s mais curta (o tempo exato da tomada varia).
- `node tests/core.test.mjs` continua passando.

## Não testado
Celular real, iPhone/Safari, interface USB real, medição de latência em laço físico, vídeo real gravado pela Central.

## Roteiro com aparelho real
Comum: abrir `daw.html`, Gravação → painel → anotar permissão e entradas; “Latência informada”; “Medir latência” 3 vezes; anotar valores e variação.
- **Android (ex.: Realme C75, Chrome):** microfone do aparelho perto do alto-falante, volume 60%; depois com interface USB‑C (OTG) e cabo da saída da interface para a entrada 1. Esperado: dezenas a centenas de ms no microfone interno; menor com interface (a medir). Verificar se a interface aparece em “Entradas”.
- **iOS (Safari):** idem; o Safari pode não informar permissão nem `outputLatency`. Interface via adaptador Lightning/USB‑C.
- **Desktop (Chrome/Edge):** interface USB com cabo de laço saída→entrada; ver variação ≤ 5 ms.
- Validação da compensação: gravar palmas em cima de um clique do metrônomo com compensação ligada e conferir no zoom da forma de onda se o ataque cai na grade (anotar o erro em ms).
- Central → DAW: gravar 30 s na Central, exportar WAV, “Enviar à DAW”, conferir duração igual e início em 0 s; repetir com vídeo (MP4/WebM) e anotar se o áudio foi extraído ou se apareceu a mensagem de codec.
