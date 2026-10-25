# Avaliação de IA local no navegador — decisão para esta entrega

**Decisão:** não habilitar automaticamente o enquadramento por IA nem
aprimoramento neural até que o modelo, os pesos, a licença dos pesos, a
compatibilidade e os resultados em Android/iOS estejam validados.

## Enquadramento de pessoa/músico

O **MediaPipe Pose Landmarker** é um candidato real de inferência local.
A documentação oficial confirma que detecta marcos corporais em imagens e
vídeos com `@mediapipe/tasks-vision`, mas sua API requer um modelo treinado.

- Guia oficial: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- Fonte do módulo web: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/pose_landmarker/pose_landmarker.ts
- Código MediaPipe: Apache-2.0 no repositório; **a licença aplicável ao
  arquivo de pesos específico precisa ser verificada separadamente**.
- Modelo/versão/pesos escolhidos nesta branch: **nenhum**.
- Teste de inferência e velocidade em 1080p/4K: **não executado**.

Detecção de corpo por si só não delimita baixo, guitarra, violão ou bateria.
Antes de ativar o recorte 9:16, 16:9 ou 4:5, será necessário considerar mãos,
instrumento, margens de segurança, baixa confiança de deteção e ajustes
manuais, além de suavizar a região de interesse entre quadros.

## Qualidade visual por IA

Há tarefas reais de segmentação para navegador documentadas em
https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter/web_js,
mas segmentar uma pessoa **não equivale** a recuperar detalhes, remover
ruído neural ou fazer super-resolução. Nenhum modelo de super-resolução foi
integrado. Ainda faltam seleção de pesos redistribuíveis, testes com imagens
de mãos/cordas, medições de memória e fallback por navegador.

O WebGPU pode acelerar inferência onde disponível, mas não é pressuposto:
https://developer.mozilla.org/en-US/docs/Web/API/Navigator/gpu

## Fallback atual

Todo o processamento disponível nesta branch permanece local e convencional:
cor/exposição, nitidez, redução espacial leve, recorte manual e estabilização
global por pontos. Nenhuma rede neural é apresentada como funcional.
Exportação 4K pode simplesmente redimensionar quadros; não recupera
informação perdida. No telefone com recursos limitados, reduzir a saída
para 1080p ou desativar filtros e estabilização.
