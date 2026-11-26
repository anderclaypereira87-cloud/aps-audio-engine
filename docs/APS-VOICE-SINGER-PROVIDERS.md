# APS Voz Studio — clonagem de voz (documento interno)

> Documento técnico interno. Na interface do usuário os provedores aparecem só como **Motor Treino** e **Motor Rápido** (marca APS).

## Estado em 26/11/2026 (auditoria ao vivo, somente leitura)
- Worker `aps-voice-vault` publicado em 20/11/2026 13:25 (horário de Recife), `https://aps-voice-vault.aps-audio.workers.dev`.
- Secrets (só nomes): `KITS_API_KEY`, `REPLICATE_API_TOKEN`.
- Variáveis: `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN` (`https://sparkling-sunset-889c.cloudflareaccess.com`).
- **Sem bindings de R2/KV** → não havia onde guardar amostras, vozes, histórico nem resultados.
- Cloudflare Access protege o hostname inteiro: `/`, `/health` e `/api/*` respondem **302** para o login do Access; preflight `OPTIONS` vindo de `https://apsaudio.com.br` recebe **403** → o site nunca conseguia chamar o Worker.
- `voice-singer.html` (site) era só um protótipo local, sem nenhuma chamada ao Worker; a única interface funcional estava embutida no Worker (atrás do Access), sem lista de vozes, sem A/B, sem DAW, e expondo o nome do provedor.
- Nenhum job de treino/conversão foi iniciado nesta auditoria.

## Arquitetura (nesta branch)
Browser (`voice-singer.html`, apsaudio.com.br) → `fetch(..., {credentials:'include'})` → Cloudflare Access → Worker `aps-voice-vault` (valida também o JWT do Access) → R2 (`VOICE_AUDIO`: amostras, guias, modelos treinados, resultados) + KV (`VOICE_KV`: vozes, jobs, contadores diários) → provedores.

| Motor (UI) | Provedor | Uso |
|---|---|---|
| Motor Treino | Replicate `replicate/train-rvc-model` (versão fixada `0397d5e2…`) + `meta-innovation/ultimate_rvc` (versão fixada `5598e802…`) | treina modelo a partir da amostra (pacote `dataset/voz/split_N.wav`, 40 kHz mono, 40 épocas) e converte guias |
| Motor Rápido | Kits AI API (`https://arpeggi.io/api/kits/v1`) | conversão com modelo de voz **já existente** na conta Kits (a API pública não oferece treino; liste com `myModels=true`) |

Modo **Automático**: usa Motor Rápido se a voz tiver modelo Kits vinculado; se der saldo/chave/limite/indisponível, cai para o Motor Treino (se a voz tiver modelo treinado). O resultado informa `fallbackFrom`.

## Rotas do Worker
| Rota | Descrição |
|---|---|
| `GET /api/health` (`?deep=1`) | motores `configured`, armazenamento, limites/uso do dia; `deep=1` faz só GETs de leitura (`/v1/account` e `voice-models`) para validar chaves — **não existe endpoint público de saldo** em nenhum dos dois provedores |
| `GET /api/auth/login?return=URL` | depois do login no Access, volta para a página (só origens permitidas) |
| `POST /api/uploads?kind=sample|guide|dataset` | corpo bruto; valida tipo real (magic bytes WAV/MP3/M4A/FLAC/ZIP), até 50 MB, duração (amostra 20 s–15 min; guia até 10 min) |
| `GET/POST /api/voices`, `DELETE /api/voices/:id`, `POST /api/voices/:id/rapido` | lista/cria/exclui/vincula vozes; treino exige `consent:true` e `confirmCost:true` |
| `POST /api/convert` | `{voiceId, guideId, pitch:-12..12, fidelity:0..1, engine:auto|rapido|treino, confirmCost:true}` |
| `GET /api/jobs`, `GET /api/jobs/:id` | histórico e polling; ao concluir copia o resultado/modelo para o R2 (URLs dos provedores expiram) |
| `GET /api/audio/uploads/:id`, `/api/audio/results/:id` | áudio privado (com CORS + credenciais) |

Proteções: limites diários (`TRAIN_DAILY_LIMIT`=2, `CONVERT_DAILY_LIMIT`=20, dia de Recife), 1 treino por vez, interruptor `PAID_JOBS_ENABLED=false`, `ALLOWED_EMAILS` opcional, `Cancel-After` nos jobs, falhas não contam no limite. Mensagens de saldo (402), chave (401/403), limite (429) e entrada (400/422) em português, sem nome do provedor.

## Publicação de 26/11/2026 (aprovada pelo Anderclay)
- Rollback do Worker: versão anterior `133257f0-7fd3-4b97-9113-e7ac542c1934` → `npx wrangler rollback 133257f0-7fd3-4b97-9113-e7ac542c1934 --name aps-voice-vault`. `origin/main` antes do merge: `9c6b6da`.
- Criados: R2 `aps-voice-vault-audio`, KV `aps-voice-vault-state` (`f51782d8b0784fa99a14f5e44fb05fd5`).
- **Caminho ativo (funciona no iPhone sem mexer no Zero Trust):** o Worker serve o próprio APS Voz Studio em `https://aps-voice-vault.aps-audio.workers.dev/` (mesma origem da API, atrás do Access → cookie first-party, sem CORS). `https://apsaudio.com.br/voice-singer.html` tenta a API direto; se o Access pedir login, o botão “Entrar com segurança” leva ao estúdio seguro. “Abrir no Estúdio (DAW)” no estúdio seguro abre `apsaudio.com.br/voice-singer.html#receber-daw` em outra aba e envia os áudios por `postMessage` (origem verificada) → IndexedDB do site → DAW.
- Todas as chamadas do front são *requisições simples* (sem preflight): JSON como `text/plain`, nome/duração na query, exclusão via `POST /api/voices/:id/delete`.
- `voz-api.apsaudio.com.br` **não** foi ativado: ficaria fora do app do Access (token do wrangler sem permissão de Access) e toda chamada daria 401.

## Passos para publicar (referência)
```bash
cd workers/aps-voice-vault
npx wrangler r2 bucket create aps-voice-vault-audio
npx wrangler kv namespace create aps-voice-vault-state   # copie o id para "VOICE_KV" em wrangler.jsonc
npx wrangler deploy                                       # secrets existentes são mantidos
```
Cloudflare Zero Trust → Access → Applications → app do `aps-voice-vault` → **Settings → CORS**:
- *Bypass OPTIONS requests to origin*: **ligado** (o Worker responde o preflight só para origens permitidas);
- *Access-Control-Allow-Credentials*: ligado; *Allowed origins*: `https://apsaudio.com.br`, `https://www.apsaudio.com.br`.
- **Cookie settings** → *SameSite*: `None`.

Recomendado para iPhone/Safari (bloqueia cookies de terceiros): domínio próprio no mesmo site, ex. `voz-api.apsaudio.com.br` (zona já está na Cloudflare). Descomente `routes` em `wrangler.jsonc`, adicione o hostname ao app do Access e abra a página com `voice-singer.html?api=https://voz-api.apsaudio.com.br` (fica salvo no aparelho) ou troque `DEFAULT_API` na página.

## Primeiro teste real
1. Confirmar créditos na conta Replicate (treino ≈ 10–30 min de GPU) e, se for usar o Motor Rápido, plano/créditos na Kits.
2. Abrir `https://apsaudio.com.br/voice-singer.html` → **Entrar com segurança** → **Diagnóstico completo** (valida as chaves sem gastar).
3. Passo 1: 2–10 min de voz limpa. Passo 2: criar voz (Treino Completo). Passo 3: guia só com voz. Passo 4: A/B, baixar, abrir no Estúdio.

## Testes
- `node --test tests/voice-cloning-worker.test.mjs` (fetch mockado, zero gasto)
- `python3 tests/e2e-aps-voice-cloning.py` (Playwright + código real do Worker em `tests/voice-cloning-mock-server.mjs`)
