# APS Central de Mídia — alinhamento ampliado

## O que foi implementado

- Busca automática por correspondência sonora com deslocamentos de até **600 segundos** (10 minutos), positiva ou negativa, na convenção `videoTime = offsetSeconds + externalTime / rate`.
- Primeiro usa múltiplos marcadores independentes próximos do início, em até 30 segundos de diferença. Se a tentativa falhar, calcula uma correlação cruzada FFT de características de ataques musicais sobre a extensão disponível, encontra uma posição candidata e **exige confirmação independente em pelo menos três trechos** antes de aplicá-la.
- A busca também reconhece um **trecho externo menor dentro de uma gravação longa**, ou vice-versa; para clipes inferiores a 3,5 segundos, exige correlação forte e concordância entre metades, mantendo a velocidade original.
- A interface informa quando foi necessária busca ampliada. Silêncio, áudio sem trecho em comum, loops repetitivos sem referência única ou cortes não lineares não são alinhados por adivinhação: o usuário recebe aviso e mantém o ajuste manual.
- O recurso é **análise digital de sinais**, não um modelo neural treinado. Não é anunciado como "sincronização por IA"; adicionar uma etapa neural de fingerprints musicais exigiria modelo, licença, desempenho e avaliação próprios.

## Verificação automatizada

`node --test central-media/tests/sync.test.mjs central-media/tests/advanced.test.mjs central-media/tests/framing.test.mjs`

Resultado: **39/39 testes passando**. Casos incluem atrasos de +55 e -65 segundos, trecho externo começando no segundo 40 do vídeo, vídeo curto correspondente ao segundo 35 do áudio externo, trecho externo de 7 segundos dentro de vídeo de 90 segundos, e medição de desvio progressivo em sinal de 590 segundos. Verifica também rejeição segura de silêncio e áudio repetitivo.

## Limitações e testes de aceitação pendentes

- Busca limitada a 10 minutos, tamanho máximo de arquivo e decodificação suportada pelo navegador; o tempo de processamento e uso de memória aumentam com duração.
- Áudio de referência do vídeo precisa ser audível e ter pelo menos um trecho comum com o áudio externo. Vídeos sem áudio ou com execução distinta devem usar ajuste manual.
- Os testes acima usam sinais sintéticos determinísticos. Não substituem verificação da **exportação** nem experiência real com arquivos MP3/WAV em Android e iPhone.
- Roteiro: carregar vídeo e áudio originalmente desencontrados, sincronizar, conferir trechos do início/meio/fim, tocar **Conferir edição**, exportar e medir alinhamento no arquivo gerado, verificar pausa, retomada, busca e download; repetir em WAV e MP3 e nos dois navegadores móveis.
