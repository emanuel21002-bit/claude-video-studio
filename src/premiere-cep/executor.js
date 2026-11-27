// Ponte do painel (CEP) para o ExtendScript do Premiere: cada comando chama movai_executar() em jsx/host.jsx, que
// devolve um JSON { ok, resultado | erro }.
/* global window */
// eslint-disable-next-line no-unused-vars
function executarComando(nome, args) {
  return new Promise(function (ok, falha) {
    var cep = window.__adobe_cep__;
    if (!cep) return falha(new Error('O painel não está dentro do Premiere.'));
    var pedido = JSON.stringify({ nome: nome, args: args || {} });
    // O texto vai como literal de string do ExtendScript.
    var codigo = 'movai_executar(' + JSON.stringify(pedido) + ')';
    cep.evalScript(codigo, function (r) {
      if (r === 'EvalScript error.' || r == null) return falha(new Error('O ExtendScript do Premiere falhou ao rodar ' + nome + '.'));
      var j;
      try {
        j = JSON.parse(r);
      } catch (e) {
        return falha(new Error('Resposta estranha do Premiere: ' + String(r).slice(0, 200)));
      }
      if (j.ok) ok(j.resultado);
      else falha(new Error(j.erro));
    });
  });
}
