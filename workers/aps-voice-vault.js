// Worker aps-voice-vault — APS Voz Studio (clonagem de voz). Lógica em ./aps-voice-vault/lib.js.
// Protegido por Cloudflare Access; o JWT do Access também é validado aqui (defesa em profundidade).
import { handle } from './aps-voice-vault/lib.js';

export default {
  fetch(request, env) {
    return handle(request, env);
  }
};
