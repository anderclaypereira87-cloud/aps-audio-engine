# APS Voice & Singer — integração segura de provedores (2026-11-20)

## Estado
- Kits AI: API oficial de conversão de voz, mas sem token de conta conectado neste projeto.
- Replicate: API para treinar modelo RVC e converter canto, mas sem token de conta conectado neste projeto.
- **Nenhum job de treinamento ou conversão foi iniciado.** Não há clonagem funcional ainda.
- Não colocar chaves em HTML, JavaScript cliente, GitHub, logs ou arquivos de configuração públicos.

## Provedores e endpoints de referência
- Kits: https://app.kits.ai/api-access — criar token com a conta do proprietário. Documentação: https://www.kits.ai/api
- Replicate: https://replicate.com/account/api-tokens — criar token com a conta do proprietário. API: https://replicate.com/docs
- Modelo de treinamento RVC: https://replicate.com/replicate/train-rvc-model
- Modelo de inferência a avaliar: https://replicate.com/meta-innovation/ultimate_rvc

## Arquitetura proposta
Browser APS -> backend autenticado -> storage privado com URL temporária -> job de provedor -> webhook autenticado/polling -> arquivo final privado -> preview e exportação.

Secrets previstos no backend: KITS_API_KEY, REPLICATE_API_TOKEN. Não habilitar jobs pagos até verificar saldo, limites, política de retenção de voz, autorização de uso e modelo selecionado.

## Edição não destrutiva
O Precision Editor exporta um mapa JSON (EDL) de cortes, destino por compasso/tempo e nota MIDI; **não altera o áudio ainda**. O motor de produção deve usar análise de transientes, regiões com crossfades, deslocamento de trechos sem resampling ingênuo, preservação de fase em faixas de bateria e algoritmo de pitch-shift preservando formantes/vibrato para voz. A quantização experimental atual usa interpolação e pode alterar timbre; não usar como master profissional.

## Critérios de aceite
1. Importar MP3/WAV pelo seletor nativo em iOS e desktop.
2. Exibir waveform real, batidas e regiões com zoom e drag touch.
3. Mover ataques/trechos por tempo sem modificar a altura musical; crossfade e preview A/B.
4. Editar notas identificadas e nota de destino por texto (ex. C4, D#4), compasso e tempo; pitch correction sem alterar duração.
5. Exportar WAV 24-bit ou 16-bit com avaliação auditiva e testes em bateria, baixo fretless e voz.
6. Somente após chave e consentimento: testar Kits e Replicate com a mesma voz de referência autorizada, comparando custo, naturalidade e fidelidade de melodia.
