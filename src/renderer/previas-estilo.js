// Prévias de 8 s dos estilos, no card da escolha de estilo. São animações feitas só de HTML/CSS (sem arquivo de vídeo
// e sem som): ficam paradas num quadro de capa e tocam enquanto o mouse está sobre o card.

const PreviasEstilo = (() => {
  const DURACAO_MS = 8000;

  // Quadro de capa de cada estilo (ms): um momento em que a edição já aparece.
  const CAPA = { 'reels-estetica': 3700, 'youtube-motion': 3000, 'reels-dinamico': 2600, minimalista: 2800, cinematografico: 2600 };

  const PALAVRAS = ['OLHA <i>ESSE</i>', '<i>BRILHO</i>', 'INSANO', 'DEIXEI <i>SEU</i>', 'CARRO', '<i>COMO</i> NOVO', 'AGENDE', '<i>AGORA</i>'];

  const MODELOS = {
    'reels-estetica': () => ({
      classe: 'p-est v',
      html: `<div class="fundoA fx"></div><div class="fundoB fx"></div><div class="reflexo"></div>
        <div class="logo">LOGO</div>
        <div class="leg l1">SEU CARRO</div><div class="leg l2">COMO NOVO</div><div class="leg l3">AGENDE JÁ</div>
        <div class="selo">R$ 150</div><div class="leak fx"></div>`,
    }),
    'youtube-motion': () => ({
      classe: 'p-yt h',
      html: `<div class="fundo fx"></div><div class="tag">01 / A IDEIA</div><div class="titulo">COMO FUNCIONA</div><div class="barra"></div>
        <div class="anel"></div><div class="num">+300%</div><div class="rot">mais retenção</div>`,
    }),
    'reels-dinamico': () => ({
      classe: 'p-din v',
      html:
        [0, 1, 2, 3].map((i) => `<div class="cena c${i + 1}" style="--d:${i * 2}s"><div class="forma"></div></div>`).join('') +
        PALAVRAS.map((p, i) => `<div class="pal" style="--d:${i}s">${p}</div>`).join(''),
    }),
    minimalista: () => ({
      classe: 'p-min v',
      html: `<div class="fundoA fx"></div><div class="fundoB fx"></div><div class="forma"></div><div class="num">01</div>
        <div class="leg l1">menos ruído.</div><div class="leg l2">mais brilho.</div><div class="linha"></div>`,
    }),
    cinematografico: () => ({
      classe: 'p-cin h',
      html: `<div class="cena fx"></div><div class="vinheta fx"></div><div class="barra t"></div><div class="barra b"></div>
        <div class="cap">CAPÍTULO I</div><div class="tit">O Brilho</div><div class="sub">Cada detalhe importa.</div><div class="fade fx"></div>`,
    }),
  };

  const RAZAO = { '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1', '4:5': '4 / 5' };

  // Estilos personalizados e salvos pelo usuário não têm uma edição pronta para mostrar: ganham uma prévia genérica no formato deles.
  function generico(estilo) {
    const h = estilo.formato === '16:9';
    return {
      classe: `p-gen ${h ? 'h' : 'v'}`,
      razao: RAZAO[estilo.formato],
      html: `<div class="fundo fx"></div><div class="bola"></div><div class="caixa"></div><div class="nome"></div>`,
      nome: estilo.nome,
    };
  }

  function criar(estilo, card) {
    const m = (MODELOS[estilo.id] ?? (() => generico(estilo)))();
    const previa = document.createElement('div');
    previa.className = 'previa';
    previa.innerHTML = `<div class="tela ${m.classe}" ${m.razao ? `style="aspect-ratio:${m.razao}"` : ''}>${m.html}</div><div class="previa-play">▶ passe o mouse</div>`;
    if (m.nome) previa.querySelector('.nome').textContent = m.nome;

    const capa = CAPA[estilo.id] ?? 3000;
    let tocando = false;
    const animacoes = () => previa.getAnimations({ subtree: true });
    const parar = () => {
      tocando = false;
      for (const a of animacoes()) {
        a.pause();
        a.currentTime = capa;
      }
    };
    const tocar = () => {
      tocando = true;
      for (const a of animacoes()) {
        a.currentTime = 0;
        a.play();
      }
    };
    card.addEventListener('mouseenter', tocar);
    card.addEventListener('mouseleave', parar);
    card.addEventListener('focus', tocar);
    card.addEventListener('blur', parar);
    // As animações só existem com o card na tela: toda vez que ele aparece, volta para o quadro de capa.
    new IntersectionObserver((itens) => {
      if (itens.some((i) => i.isIntersecting) && !tocando && !card.matches(':hover')) parar();
    }).observe(previa);
    return previa;
  }

  return { criar, DURACAO_MS };
})();
