// Worker aps-voice-vault — APS Voz Studio (clonagem de voz). Lógica em ./aps-voice-vault/lib.js.
// Protegido por Cloudflare Access; o JWT do Access também é validado aqui (defesa em profundidade).
// A mesma voice-singer.html do site é servida em "/" (mesma origem da API → funciona no iPhone).
import { handle } from './aps-voice-vault/lib.js';
import studioHtml from '../voice-singer.html';

export default {
  fetch(request, env) {
    return handle(request, env, { studioHtml });
  }
};
