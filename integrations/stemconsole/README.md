# StemConsole no APS Audio Engine

Integração REST preparada no repositório existente. **Não ativada em produção**:
falta cadastrar a chave e montar o adaptador no Worker `aps-pagamentos` existente.
Não é necessário criar outro site, banco ou projeto Supabase.

## Comportamento

- `separador.html` carrega `ui.mjs`, com modos de 2, 4 e 6 pistas.
- A música inteira, até 10 minutos e 100 MB, é enviada sem decodificação PCM e sem
  inferência neural no celular. Os controles de trecho do modo local não se aplicam.
- A primeira ativação fica restrita ao dono autenticado no APS. O adaptador valida
  o token de sessão contra o `/status` do Worker atual e exige `owner === true`.
  Uma assinatura Pro do APS, por si só, não autoriza consumir a conta do dono.
- O serviço usa o plano e os créditos da conta StemConsole. Não há compra de
  assinatura/créditos nem conversão automática de 6 para 4 pistas.
- O cliente usa o mesmo `Idempotency-Key` ao retentar o mesmo arquivo e modo na
  sessão. A consulta pode ser pausada/retomada; não chama `DELETE`, pois esse
  endpoint apaga a música, não interrompe a inferência de uma música avulsa.
- As pistas MP3 podem ser ouvidas, baixadas, reunidas em ZIP e enviadas pelo
  IndexedDB existente ao mixer ou ao módulo de timbres da bateria.
- Não modifica `separador.js`, `separador-worker.js` nem o processamento HTDemucs.
- A API consultada não oferece separação das peças individuais da bateria.

## Ativação no Worker existente

Copiar `worker.mjs` para o código fonte do **mesmo** Worker `aps-pagamentos` e
montar antes das rotas de pagamento. O adaptador retorna `null` nas demais rotas:

```js
import { handleStemConsole } from './integrations/stemconsole/worker.mjs';

export default {
  async fetch(request, env, context) {
    const stemConsole = await handleStemConsole(request, env);
    if (stemConsole) return stemConsole;
    return existingHandler(request, env, context); // handler real já existente
  }
};
```

O exemplo não substitui o código de pagamentos. Obter o código atual do Worker e
preservar suas rotas/bindings antes de integrar. Também é possível fornecer ao
adaptador o verificador de dono já existente: `{ authorize: async request => … }`.
Esse callback deve verificar assinatura e autorização no servidor; nunca aceitar
e-mail, plano, `owner` ou token declarados pelo próprio cliente sem validação.

Em **Settings → Variables and Secrets** do mesmo Worker:

| Nome | Tipo | Valor |
| --- | --- | --- |
| `STEMCONSOLE_API_KEY` | Secret | Chave existente do dono; nunca colocar no HTML, Git ou chat |
| `STEMCONSOLE_ENABLED` | Texto | `true`, somente quando a conta estiver pronta para uso |
| `STEMCONSOLE_ALLOWED_ORIGINS` | Texto opcional | Padrão: `https://apsaudio.com.br,https://www.apsaudio.com.br` |
| `STEMCONSOLE_DOWNLOAD_HOSTS` | Texto opcional | Hosts HTTPS adicionais, somente se retornados pela API real e verificados |

O cliente usa `APS_PAY_URL + '/stemconsole'`. `APS_STEMCONSOLE_URL` permite um
endereço público de API diferente, configurado pelo mantenedor no código.
Nunca incluir credenciais na URL. Sem ativação explícita e chave, não é feita
nenhuma chamada de separação. Rotas autenticadas respondem 503.

## Contrato implementado

| APS | StemConsole |
| --- | --- |
| `GET /stemconsole/config` | Configuração pública, sem chamar o provedor |
| `GET /stemconsole/account` | `GET /api/v1/me` |
| `POST /stemconsole/splits` | `POST /api/v1/splits`, multipart em fluxo |
| `GET /stemconsole/splits/{id}` | `GET /api/v1/splits/{id}` |
| `GET /stemconsole/splits/{id}/stems/{name}` | Resolve `stems[].mp3_url` no servidor e transmite MP3 |

Os links são resolvidos a partir da resposta autenticada do provedor, com
allowlist de hosts HTTPS e validação de todos os redirecionamentos. As URLs
assinadas de áudio nunca recebem a chave da API nem o token do APS.
São propagados os erros de plano (402), tamanho (413) e limite temporário (429,
respeitando `Retry-After` durante a consulta).

## Limites que precisam ser validados com a conta real

- A documentação OpenAPI deixa os schemas de resposta livres. O exemplo oficial
  especifica `stems[].mp3_url`; este adaptador usa esse campo confirmado.
- WAV não está implementado: Pro/crédito oferece WAV, mas o campo/link exato não
  aparece no exemplo público. Conferir a resposta real antes de adicioná-lo.
  MP3 não é convertido para WAV nem anunciado como áudio sem perdas.
- Upload multipart acima de 100 MB não está implementado. A API dispõe de upload
  em partes até 200 MB, que pode ser acrescentado depois de validar o contrato.
- Confirmar o shape real de `/me`, estados da separação, hosts de áudio e a conta
  `owner` do APS. A conta/grant atual não foi consultada sem credenciais.
- Os testes locais usam respostas controladas. Não homologam processamento real
  do StemConsole, tempo de fila, qualidade musical ou uso no Android físico.

## Verificação

```bash
node --test tests/stemconsole.test.mjs
node tests/core.test.mjs
```

Fontes consultadas em 07/11/2026:

- https://stemconsole.ai/developers/
- https://stemconsole.ai/api/v1/openapi.json
- https://stemconsole.ai/pricing/

Os limites de conta apresentados pelo próprio StemConsole e o resultado de
`GET /me` prevalecem sobre qualquer preço ou quota guardados em documentação.
