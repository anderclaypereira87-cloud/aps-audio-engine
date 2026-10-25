# Avaliação de IA local no navegador — decisão para esta entrega

**Decisão atual:** implementar um botão opt-in para detecção neural de pessoa,
mantendo-a **desligada por padrão** e sem alegação de homologação móvel.
Não habilitar aprimoramento neural de imagem sem modelo, licença e validação.

## Enquadramento de pessoa/músico

O **MediaPipe Pose Landmarker Lite** é a implementação experimental de
inferência local na Central, não um recorte fixo disfarçado de IA.
A documentação oficial confirma que detecta marcos corporais em imagens e
vídeos com `@mediapipe/tasks-vision`.

- Guia oficial: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- Fonte do módulo web: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/pose_landmarker/pose_landmarker.ts
- Card dos pesos escolhidos, declarados sob Apache-2.0:
  https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf
- Runtime: `@mediapipe/tasks-vision@1.1.1`, módulo ESM jsDelivr;
  base de WASM `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm`.
- Modelo: `pose_landmarker_lite.task`, `float16/1`, origem:
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- Execução: CPU em Worker, até 600 amostras por vídeo, um corpo. Ausência de
  detecção confiável gera erro claro e preserva o recorte manual.
- **Teste real de inferência e velocidade Android/iOS ainda não executado**.

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

Cor/exposição, nitidez, redução espacial leve, recorte manual e estabilização
global por pontos permanecem convencionais. Só o **enquadramento da pessoa**
usa modelo neural (quando ativado e disponível).
Exportação 4K pode simplesmente redimensionar quadros; não recupera
informação perdida. No telefone com recursos limitados, reduzir a saída
para 1080p ou desativar filtros e estabilização.
