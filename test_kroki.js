const dot = `digraph ER {
  rankdir=LR;
  node [shape=none, fontname="Helvetica", fontsize=10, margin=0];
  edge [fontname="Helvetica", fontsize=9, dir=both, color="#777777"];
  Users [label=<
    <table border="0" cellborder="1" cellspacing="0" cellpadding="4">
      <tr><td bgcolor="#ffcc99" colspan="3"><b>Users</b></td></tr>
      <tr><td align="left" port="id">🔑 <b>id</b></td><td align="left"><font color="#666666">INTEGER</font></td><td align="right"><b>N</b></td></tr>
    </table>
  >];
  Posts [label=<
    <table border="0" cellborder="1" cellspacing="0" cellpadding="4">
      <tr><td bgcolor="#ffcc99" colspan="3"><b>Posts</b></td></tr>
      <tr><td align="left" port="id">🔑 <b>id</b></td><td align="left"><font color="#666666">INTEGER</font></td><td align="right"><b>N</b></td></tr>
    </table>
  >];
  Posts:id -> Users:id [arrowtail=crow, arrowhead=teetee, style=dashed];
}`;

fetch('https://kroki.io/graphviz/svg', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: dot
}).then(r => r.text()).then(t => console.log(t.substring(0, 100) + "... " + (t.includes('svg') ? "SUCCESS" : "FAIL")));
