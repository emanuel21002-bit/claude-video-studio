import React from 'react';

// Efeitos sob medida (selo animado, light leak, gráfico…). Cada componente registrado aqui vira um item
// { "tipo": "bloco", "componente": "<Nome>", "props": { … } } na timeline. Recebe as props e duracaoFrames.
export const blocos: Record<string, React.FC<any>> = {};
