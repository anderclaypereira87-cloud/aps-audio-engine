# DAW — vídeo durante a gravação de uma pista

Escopo: continuidade da issue #15 (Work) e integração da issue #16 (Grok). A câmera da Central de Mídia continua intacta. Esta frente não altera separação, mix/master, autenticação ou Supabase.

## O que o músico faz

1. Abrir `daw.html?modulo=gravacao`, conectar a interface USB/microfone e usar fones.
2. Em **Gravação e afinador**, marcar **Gravar vídeo junto com a pista de áudio** e escolher câmera frontal, traseira ou webcam.
3. Clicar **Gravar instrumento**. O navegador pede acesso à câmera (o áudio já é obtido pelo gravador da DAW). A câmera mostra uma prévia sem retorno nos alto-falantes.
4. A contagem de compassos da DAW ocorre normalmente. O mesmo track físico de microfone alimenta o AudioWorklet que grava WAV e o MediaRecorder que grava áudio+vídeo.
5. Ao terminar, a pista de áudio entra na DAW como antes e continua disponível em WAV original; a captura de vídeo aparece para baixar. Se não houver outro vídeo na sessão, o novo entra automaticamente na linha do tempo. Havendo vídeo anterior, o botão **Inserir vídeo na DAW** pergunta antes de substituir.

## Sincronismo e limites

- O vídeo (câmera + microfone) é gravado pelo mesmo `MediaRecorder` com duas tracks em um `MediaStream`; não se abre uma segunda captura de microfone.
- O início estimado do vídeo é posicionado na timeline usando o relógio `AudioContext.currentTime`, compensando a antecedência com que o MediaRecorder começou em relação ao AudioWorklet. O campo **Início do vídeo (s)** permanece ajustável.
- **Isto não garante sincronização no nível do quadro**: `MediaRecorder.start()` não expõe timestamps precisos do primeiro frame e a latência do dispositivo varia. Confirmar com palmas/ataques rápidos no início e no fim. A frente de fingerprint (#22) pode servir para refinamento futuro.
- O gravador de vídeo compartilha o limite de até 10 minutos e 768 MiB; grava blocos para armazenamento local OPFS quando disponível e usa fallback limitado em RAM (96 MiB), reutilizando `central-media/recording/chunk-store.js`.
- Falha na câmera ou no formato MP4/WebM não bloqueia a pista WAV. Falha de espaço/integridade do vídeo não produz download truncado rotulado como original. Não há upload.
- No começo de uma tomada com vídeo, há antecipação de ~1,2 s para que o navegador prepare a captura; áudio sem vídeo conserva o comportamento antigo.
- Navegadores podem bloquear gravação de áudio+vídeo por formato/codec. Seleção de câmera depende das permissões e do sistema. Interface USB depende de reconhecimento no navegador.

## Validação realizada nesta frente

- Sintaxe do novo JS conferida.
- Revisado que o áudio já capturado por `createCapture` continua gerando a pista e o WAV, sem sintetizar notas nem modificar execução.
- Verificado o diff: apenas `aps-daw-video.js`, pontos locais em `daw.html` e cache PWA em `sw.js`.
- **Ainda faltam testes reais** no Android Chrome, Safari/iPhone e desktop com webcam/interface USB, incluindo 2 segundos, 10 minutos, falhas de permissão, falta de espaço e correção manual de offset.
- **Não publicar antes desses testes de integração**, ou publicar somente após o proprietário concordar com testar a versão experimental no site original. A versão de produção atual não deve ser sobrescrita silenciosamente.

Roteiro de aceite: abrir DAW em HTTPS; marcar gravação com câmera; gravar primeiro um take de 2–3 s com uma palma, verificar que WAV e vídeo têm som; anexar à linha do tempo e ouvir a base; repetir com diferentes câmeras, um take longo e uma interface USB; conferir início/meio/fim e download no Android/iPhone.
