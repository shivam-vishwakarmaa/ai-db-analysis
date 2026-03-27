function buildGraphvizER(schema, selTable) {
  let lines = [
    'digraph ER {',
    '  rankdir=LR;',
    '  node [shape=none, fontname="Helvetica", fontsize=10, margin=0];',
    '  edge [fontname="Helvetica", fontsize=9, dir=both, color="#777777"];'
  ]
  const tables = schema.tables || []
  const rels = schema.relationships || []
  
  let relevantTables = tables
  let relevantRels = rels
  if (selTable) {
    relevantRels = rels.filter(r => r.from_table === selTable || r.to_table === selTable)
    const tableNames = new Set([selTable])
    relevantRels.forEach(r => { tableNames.add(r.from_table); tableNames.add(r.to_table) })
    relevantTables = tables.filter(t => tableNames.has(t.name))
  }

  for (const t of relevantTables) {
    const safeName = t.name.replace(/[^a-zA-Z0-9_]/g, '')
    const pks = new Set(t.primary_keys || [])
    const fks = new Set((t.foreign_keys || []).map(f => f.column))
    
    // Check if weak entity (all PKs are FKs)
    const isWeak = pks.size > 0 && Array.from(pks).every(pk => fks.has(pk))
    const headerColor = isWeak ? '#ffb3b3' : '#ffcc99' // Weak entity uses red-ish, strong uses orange

    let html = `  ${safeName} [label=<\n    <table border="0" cellborder="1" cellspacing="0" cellpadding="4">\n`
    html += `      <tr><td bgcolor="${headerColor}" colspan="3"><b>${t.name}</b>${isWeak ? ' &lt;&lt;Weak&gt;&gt;' : ''}</td></tr>\n`
    
    for (const c of (t.columns || [])) {
      const isPk = pks.has(c.name)
      const isFk = fks.has(c.name)
      let icon = isPk ? '🔑' : (isFk ? '🔗' : '📄')
      let nameStr = isPk ? `<b>${c.name}</b>` : c.name
      let nullStr = !c.nullable ? '<b>N</b>' : '' // 'N' for NOT NULL
      
      const safePort = c.name.replace(/[^a-zA-Z0-9_]/g, '')
      html += `      <tr><td align="left" port="${safePort}">${icon} ${nameStr}</td><td align="left"><font color="#666666">${c.type || 'TEXT'}</font></td><td align="right">${nullStr}</td></tr>\n`
    }
    html += `    </table>\n  >];`
    lines.push(html)
  }

  const seenRels = new Set()
  for (const r of relevantRels) {
    const fromSafe = r.from_table.replace(/[^a-zA-Z0-9_]/g, '')
    const toSafe = r.to_table.replace(/[^a-zA-Z0-9_]/g, '')
    const fromColSafe = r.from_column.replace(/[^a-zA-Z0-9_]/g, '')
    const toColSafe = r.to_column.replace(/[^a-zA-Z0-9_]/g, '')
    
    const key = `${fromSafe}-${toSafe}-${r.from_column}`
    if (seenRels.has(key)) continue
    seenRels.add(key)
    
    const childTable = tables.find(t => t.name === r.from_table)
    const childCol = childTable?.columns?.find(c => c.name === r.from_column)
    const isTotal = childCol ? !childCol.nullable : false
    const lineStyle = isTotal ? 'solid' : 'dashed'

    const arrtail = 'crow'     // "Many" side
    const arrhead = 'teetee'   // "One" side (1 and only 1)
    
    lines.push(`  ${fromSafe}:${fromColSafe} -> ${toSafe}:${toColSafe} [arrowtail=${arrtail}, arrowhead=${arrhead}, style=${lineStyle}];`)
  }

  lines.push('}')
  return lines.join('\n')
}

const mockSchema = {
    tables: [{
        name: "Users",
        primary_keys: ["id"],
        foreign_keys: [],
        columns: [
            {name: "id", type: "INTEGER", nullable: false},
            {name: "name", type: "VARCHAR", nullable: true}
        ]
    }],
    relationships: []
};

console.log(buildGraphvizER(mockSchema, null));
