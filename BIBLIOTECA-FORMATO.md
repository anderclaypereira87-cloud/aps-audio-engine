# Formato da Biblioteca APS (`aps-library/1`)

Pacote `.zip` (sem compressão, mesmo ZIP do projeto `.aps`) para timbres e grooves enviados pelo usuário.

```
manifest.json
samples/001-bateria.wav      (PCM 16 bits, taxa original, mono/estéreo)
samples/002-sanfona.wav
```

## manifest.json
```json
{
  "format": "aps-library/1",
  "created": "2026-10-23T06:00:00.000Z",
  "author": "",                       
  "license": "consentimento-APS-v1",  
  "consent": {"granted": true, "version": "2026-10-v1", "at": "…", "contributorId": "uuid", "history": [ … ]},
  "notes": "",
  "items": [{
    "id": "uuid",
    "file": "samples/001-bateria.wav",
    "kind": "groove | timbre",
    "instrument": "voz|baixo|violao|teclado|sanfona|sopro|bateria|percussao|mix",
    "style": "forro|piseiro|funk|gospel|sertanejo|trap|pop|mpb",
    "bpm": 120, "timeSignature": "4/4", "key": null,
    "groove": {"pattern": "x--x----x--x----", "kick": "x--x----x-------", "swing": 0, "density": 6.1},
    "durationSec": 4.8, "sampleRate": 44100, "channels": 1,
    "tags": ["🥁 Bateria", "120 BPM", "Forró", "reto"],
    "source": {"app": "APS Audio Engine", "region": "nome da região"}
  }]
}
```

- `groove.pattern`: 16 semicolcheias de um compasso 4/4 (`x` forte, `·` fraco, `-` vazio); `kick`: só os graves.
- `swing`: atraso médio das semicolcheias pares em % do passo.
- Gerado por `APSLibrary.buildPackage(regioes)`; envio por `APSLibrary.upload(pkg)` (placeholder, sem servidor;
  exige consentimento ativo). Exclusão: `APSLibrary.requestDeletion()`.
- Para ativar no futuro: definir `window.APS_LIBRARY_ENDPOINT` e implementar `upload` (HTTPS, autenticado),
  com confirmação da exclusão pelo servidor.
