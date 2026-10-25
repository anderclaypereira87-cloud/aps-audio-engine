# Integração com a DAW existente

Não é necessário alterar `daw.html` para importar o WAV final. O código existente já recebe este contrato:

| Campo | Valor |
|---|---|
| Banco IndexedDB local | `aps-media-transfer`, versão `1` |
| Object store | `files` |
| Chave | `next` |
| Valor | `{ file: File, created: Date.now() }` |
| File desta frente | WAV PCM 16-bit, 48 kHz, mono ou estéreo; alinhamento e efeitos já aplicados |
| Destino | `./daw.html?modulo=gravacao&importar=midia` |
| Evento disparado pela página atual da DAW | `aps:import-media-file`, `detail: file` |

O receptor atual lê/exclui `next` e encaminha o evento a `importFiles([e.detail])`. A transferência só navega depois do commit da transação IndexedDB. Em erro, a Central mantém o WAV para download e importação manual.

## Retorno futuro da mixagem/masterização

Ainda não existe uma ponte de retorno implementada nesta mudança. O usuário pode baixar o master da DAW e selecioná-lo como áudio externo na Central.

Proposta para a integração final, sem modificar a DAW nesta frente: um armazenamento separado `aps-media-return-v1` com `{ file, created, sourceDuration, preservesTimeline: true }` e URL `midia.html?importar=daw`. O responsável deverá definir retenção, identificação de sessão e confirmação de duração antes de implementar. Se a DAW mudar cortes/velocidade/duração, é necessário sincronizar novamente; não reutilizar silenciosamente um offset antigo.

Nenhum contrato requer Supabase, novo banco remoto, upload ou acesso ao código das outras frentes.
