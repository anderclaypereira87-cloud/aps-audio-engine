# Captura de câmera + áudio — issue #15

Implementação na Central de Mídia existente. Base inicial: `main` em
`d50f3b83886b60237d6a13535a5f0b5caee5367b`; branch `feat/aps-live-recording`.
Os PRs anteriores da Central de Mídia (#5, #7, #10–#13) já estavam integrados;
não havia PR aberto concorrendo em `midia.html` ou `media-ui.js` na preparação.
O proprietário autorizou nesta conversa a publicação no site original para
realizar pessoalmente os testes em celulares físicos.

## Usar

1. Na Central de Mídia, toque em **Ativar câmera e áudio** e permita as duas entradas.
2. Escolha câmera e microfone/interface. Depois de trocar, toque em ativar novamente.
3. Confira a imagem e o medidor; toque em **Iniciar** e depois **Parar**.
4. Use **Reproduzir gravação** para conferir o arquivo, depois **Baixar original**.
5. **Abrir gravação no editor** importa o `File` pelo caminho existente e seleciona
   **Manter o áudio original**. Um áudio externo antigo não é selecionado automaticamente.

## Comportamento e limites

- `getUserMedia` ocorre somente no clique de ativação; uma chamada solicita áudio e vídeo.
  São usadas as faixas originais desse mesmo `MediaStream` em um único `MediaRecorder`.
- Lista de câmeras/entradas após permissão, seleção por `deviceId`, preferências frontal/traseira
  por `facingMode`. Interfaces USB só aparecem se o SO/navegador as expuser.
- Prévia `playsinline` e `muted`; o grafo do medidor conecta entrada → analisador, sem conexão
  aos alto-falantes. RMS/clip não altera o sinal gravado. As três opções de processamento
  automático de microfone são solicitadas como `false`; o dispositivo pode ignorá-las.
- Negociação via `isTypeSupported` e tentativa do construtor. Prioriza MP4 AVC/AAC explícito,
  WebM VP8/Opus, WebM VP9/Opus, depois contêineres genéricos. MP4 genérico pode escolher
  outros codecs: a extensão segue o MIME real e o relatório lê os codecs do arquivo.
- Blocos de aproximadamente 1 s, gravação solicitada a parar em 9:59, reservando cerca de 1 s
  para a finalização. Limite de 768 MiB; reserva de 4 MiB antes do teto para o bloco final.
  Os eventos do navegador não têm pontualidade garantida. Arquivo acima de 600 s fica
  disponível como original, com aviso e importação bloqueada até ser recortado.
- OPFS grava os blocos sequencialmente no aparelho, respeitando a estimativa de quota.
  Sem OPFS/espaço, usa memória com teto menor de 96 MiB. Fila de escrita limitada a 96 MiB.
  Falha/overflow invalida o take inteiro: não oferece um prefixo truncado como original.
- Dispositivos e medidor desligam ao parar, cancelar, trocar seleção, sair/ocultar a página,
  revogar permissão, perder uma faixa ou ficar 90 s na prévia sem iniciar. Uma permissão
  concedida depois de desligar não reativa dispositivos. Não há reativação automática.
- O resultado é temporário; baixar antes de sair. Descartar libera o arquivo; se já estiver
  aberto no editor, sua fonte em disco é mantida até outra gravação ser importada ou a página
  ser fechada. Limpeza em `pagehide` é uma tentativa: encerramento abrupto pelo SO pode deixar
  temporários sob a quota local do site. Limpar dados do site pelo navegador remove esses dados.
- Reabre o contêiner final com o Mediabunny já incluído no projeto, lê as duas faixas,
  timestamps e duração; tenta decodificar um quadro e até 2 s de áudio do arquivo salvo.
  Mostra quando a decodificação não está disponível. Não mede alinhamento da execução
  musical, latência física da interface, nem garante sincronismo perfeito.
- Nenhum upload, CDN nova, serviço pago, credencial, Supabase ou módulo de DAW/separação foi adicionado.

## Evidências automatizadas — 25/10/2026

- 9 testes Node da captura/armazenamento e 39 testes existentes da Central de Mídia aprovados.
- Checagem sintática dos módulos e `git diff --check` aprovados.
- Chromium headless 153.0.8010.0 com câmera falsa e tom de 440 Hz por entrada de áudio falsa.
  São APIs reais de captura/codificação, com entradas simuladas, sem câmera/microfone físicos.
- 11 casos: gravação/download/importação no desktop; fonte preservada no editor após descartar
  o resultado do gravador; perfil Android com fallback WebM/memória; perfil iPhone com seleção
  por ID e cancelamento; negação de permissão; formato indisponível; permissão atrasada após
  desligar; erro de quota; eventos simulados `ended`, `mute` e tela oculta.
- Zero erros JavaScript ou requisições externas nesses testes. As duas gravações baixadas
  reabriram com VP8/Opus, imagem e áudio decodificados. O ffmpeg também decodificou os arquivos
  completos; `file-evidence.json` registra frames, sinal de áudio e timestamps reais.
- **Android e iPhone são apenas emulação de viewport/UA em Chromium. Não validam Android real,
  Safari/WebKit, permissões do SO, Bluetooth/USB, gravação contínua de 10 minutos ou baixa memória.**

Resultados: [browser-evidence.json](./evidence/browser-evidence.json) e
[file-evidence.json](./evidence/file-evidence.json).
Telas: [desktop](./evidence/desktop.png), [Android emulado](./evidence/android-emulation.png),
[iPhone emulado](./evidence/iphone-emulation.png).

### Reproduzir

```sh
node --test central-media/recording/tests/*.test.mjs central-media/tests/*.test.mjs
node --check central-media/recording/recording-ui.js
node --check central-media/media-ui.js
git diff --check
ffmpeg -v error -f lavfi -i sine=frequency=440:sample_rate=48000:duration=5 -ac 1 -c:a pcm_s16le -y /tmp/aps-recording-tone.wav
APS_TEST_CHROME=/caminho/do/chromium APS_RECORDING_TEST_AUDIO=/tmp/aps-recording-tone.wav node central-media/recording/tests/browser.cjs
python central-media/recording/tests/verify-files.py /tmp/aps-recording-evidence
```

Playwright é apenas dependência do executor de testes, não do site.
Os arquivos baixados sintéticos ficam em `/tmp/aps-recording-evidence`; os hashes estão nas evidências.

## Roteiro em aparelhos físicos — pendente, a ser executado pelo proprietário

Registrar modelo, versão de Android/iOS, navegador, formato/codec exibido e resultado de cada etapa.
O próprio arquivo baixado deve ser aberto no player do telefone ou computador.

1. **Android/Chrome e iPhone/Safari:** abrir `https://apsaudio.com.br/midia.html?gravacao=20261025`,
   atualizar e confirmar que nenhuma permissão aparece antes de tocar em ativar.
2. Permitir câmera e áudio, gravar 20–30 s falando/tocando. Fazer uma palma visível no início,
   meio e final. Parar; verificar indicador de câmera/microfone desligado.
3. Reproduzir **o resultado gravado**, baixar, abrir o download no player do SO e ouvir/ver as
   três palmas. Registrar qualquer atraso entre imagem e som; os timestamps sozinhos não bastam.
4. Abrir no editor e confirmar **Manter o áudio original**, ouvir a prévia, exportar um trecho
   curto se o navegador oferecer os codecs e conferir novamente o arquivo exportado.
5. Repetir com câmera frontal e traseira. No computador, repetir com webcam e interface USB,
   confirmando o nome da entrada e um sinal exclusivo nela; não basta aparecer na lista.
6. Testar negar e depois liberar permissão nas configurações; revogar durante a captura;
   desconectar a interface; trocar câmera; atender uma ligação; bloquear a tela e mudar de aba.
   A captura deve encerrar e permitir ativação novamente, sempre por toque.
7. Cancelar antes e depois de 1 s: não deve haver resultado da gravação cancelada. Deixar a
   prévia parada por 90 s: os dispositivos devem desligar.
8. Com espaço disponível, gravar próximo de 10 minutos e conferir parada, download, tamanho,
   áudio/imagem no início/meio/final e duração real. Repetir em condição de pouco espaço
   somente se conveniente; gravador deve parar com mensagem e preservar os outros arquivos.

## Referências de API

- [W3C MediaStream Recording](https://www.w3.org/TR/mediastream-recording/): chunks individuais
  não precisam ser reproduzíveis isoladamente; o arquivo é formado após o encerramento.
- [W3C Media Capture and Streams](https://w3c.github.io/mediacapture-main/): faixas, permissões
  e eventos de alteração dos dispositivos.
