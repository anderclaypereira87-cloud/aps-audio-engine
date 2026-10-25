# Central de Mídia — prévia sem áudio externo em clipes curtos

## Problema observado em 25/10/2026

Após selecionar um vídeo e um áudio externo de aproximadamente dois
segundos e usar a sincronização automática, o som externo não era ouvido
junto à prévia. A revisão da implementação encontrou dois fatores:

1. Arquivos MP3 tinham `nativePreviewReady=false` inicialmente. Se a
   comparação do atraso do decoder falhasse, esse sinal permanecia falso e
   `syncPlayback` recusava toda reprodução do elemento externo.
2. O botão **Conferir edição** aguardava o carregamento assíncrono do
   AudioWorklet *antes* de chamar `video.play()`. Em clipes de 2 segundos,
   o trabalho de inicialização e restrições de gesto do navegador podem
   bloquear ou atrasar o segundo player.

## Correção

- A reprodução externa nunca fica deliberadamente muda apenas porque a
  calibração MP3 falhou. A prévia continua audível, com aviso de que o player
  nativo pode introduzir atraso; a exportação segue os timestamps decodificados.
- `nativePreviewCalibrated` passa a distinguir **ouvir** da garantia de
  **calibração** registrada no relatório técnico.
- Os dois elementos de mídia recebem `play()` dentro do mesmo gesto de
  **Conferir edição**, antes de qualquer espera por efeito de áudio.
- Clipes abaixo de 3,5 segundos usam reprodução HTML de baixa latência,
  mantendo a exportação com filtros profissionais. Se AudioWorklet estiver
  indisponível em clipes longos, a prévia usa fallback direto em vez de parar.
- Deslocamento positivo: o áudio externo inicia silenciado e tem seu começo
  sincronizado quando chega a posição adequada; para deslocamento negativo,
  a prévia avança na faixa externa.
- A prévia agora aceita `video.readyState >= 2` e tenta retomar o áudio no
  evento `play`, evitando exigir um buffer mais longo que o próprio clipe.

## Evidências e pendências

- `node --check central-media/media-ui.js`: passou.
- 39 testes Node de sincronização, vídeo e enquadramento: passaram, incluindo busca ampliada.
- **Não foi possível realizar teste de reprodução com os arquivos reais do
  usuário:** eles foram enviados diretamente ao site e não estão anexados
  nesta conversa. O navegador local não pôde iniciar por restrição de socket
  neste ambiente. Portanto o teste audiovisual real em Android continua
  pendente; não declarar que o som foi ouvido sem esse teste.
- Roteiro: importar vídeo e áudio externos de 2s, sincronizar, tocar
  **Conferir edição**, verificar som externo audível, posição dos ataques,
  troca entre original/edição, pausa, busca, atraso positivo/negativo e
  exportação reproduzida em player independente. Repetir WAV e MP3.
