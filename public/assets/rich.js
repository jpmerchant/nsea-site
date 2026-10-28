/* Tiny, safe text formatter for Coach's Corner posts. Builds DOM nodes only (never innerHTML).
   Paragraphs = blank-line separated; lines starting "- " = bullet list; **bold**, *italic*, [text](https://link). */
(function () {
  var INLINE = /\*\*([^*]+?)\*\*|\*([^*]+?)\*|\[([^\]]+?)\]\(((?:https?:\/\/|mailto:|\/)[^\s)]+)\)/g;
  function inline(text, parent) {
    var last = 0, m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var n;
      if (m[1] != null) { n = document.createElement('strong'); n.textContent = m[1]; }
      else if (m[2] != null) { n = document.createElement('em'); n.textContent = m[2]; }
      else { n = document.createElement('a'); n.textContent = m[3]; n.setAttribute('href', m[4]); if (/^https?:/.test(m[4])) { n.setAttribute('rel', 'noopener'); n.setAttribute('target', '_blank'); } }
      parent.appendChild(n);
      last = INLINE.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  window.NSEA_rich = function (text) {
    var frag = document.createDocumentFragment();
    String(text || '').replace(/\r/g, '').split(/\n\s*\n/).forEach(function (block) {
      block = block.trim(); if (!block) return;
      var lines = block.split('\n');
      if (lines.every(function (l) { return /^\s*[-•]\s+/.test(l); })) {
        var ul = document.createElement('ul');
        lines.forEach(function (l) { var li = document.createElement('li'); inline(l.replace(/^\s*[-•]\s+/, ''), li); ul.appendChild(li); });
        frag.appendChild(ul);
      } else {
        var p = document.createElement('p');
        lines.forEach(function (l, i) { if (i) p.appendChild(document.createElement('br')); inline(l, p); });
        frag.appendChild(p);
      }
    });
    return frag;
  };
  window.NSEA_plain = function (text, max) {
    var t = String(text || '').replace(/\*\*|\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
  };
})();
