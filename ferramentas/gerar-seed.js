// Gera privado/seed.sql a partir de privado/data.js e dados/coords.js.
// Uso: node ferramentas/gerar-seed.js
// O arquivo gerado contém dados internos: ele NÃO é publicado no site (fica fora de public/).
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');

global.window = {};
require(path.join(raiz, 'privado/data.js'));
require(path.join(raiz, 'dados/coords.js'));
const D = window.AGRO_DATA, C = window.AGRO_COORDS;

const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const linhas = ['-- Gerado por ferramentas/gerar-seed.js — não editar à mão', 'begin;',
  'truncate public.indicadores, public.estado_totais, public.municipio_registros, public.municipio_coordenadas, public.bases restart identity cascade;'];
const ins = (tabela, cols, rows, depois = '') => { if (rows.length) linhas.push(`insert into public.${tabela} (${cols.join(', ')}) values\n  ${rows.map((r) => `(${r.map(q).join(', ')})`).join(',\n  ')}${depois ? `\n${depois}` : ''};`); };

const bases = ['leads', 'clientes', 'parceiros'];
ins('bases', ['id', 'titulo', 'singular', 'plural', 'fonte', 'nota_percentual', 'total_com_uf'],
  bases.map((b) => [b, D[b].titulo, D[b].singular, D[b].plural, D[b].fonte || '', D[b].notaPercentual || '', D[b].totalComUF]));
ins('indicadores', ['base_id', 'ordem', 'rotulo', 'valor', 'sub', 'status'],
  bases.flatMap((b) => D[b].kpis.map((k, i) => [b, i + 1, k.rotulo, k.valor, k.sub || '', k.status || null])));
ins('estado_totais', ['base_id', 'uf', 'total', 'percentual', 'nota', 'ordem'],
  bases.flatMap((b) => Object.entries(D[b].porEstado).map(([uf, r], i) => [b, uf, r.total, r.pct || '', r.nota || '', i + 1])));
ins('municipio_registros', ['base_id', 'uf', 'municipio', 'quantidade', 'ordem'],
  ['leads', 'clientes'].flatMap((b) => Object.entries(D[b].porEstado).flatMap(([uf, r]) => r.municipios.map(([m, n], i) => [b, uf, m, n, i + 1]))));
// Status é dado operacional: seed mantém IDs/status existentes e sincroniza só a ordem.
ins('parceiros', ['nome', 'municipio', 'uf', 'status', 'ordem'],
  Object.entries(D.parceiros.porEstado).flatMap(([uf, r]) => r.pessoas.map(([nm, m, st], i) => [nm, m, uf, st, i + 1])),
  'on conflict (nome, municipio, uf) do update set ordem = excluded.ordem');
ins('municipio_coordenadas', ['uf', 'municipio', 'x', 'y', 'lat', 'lon', 'cod_ibge', 'nome_oficial'],
  Object.entries(C.pontos).map(([k, v]) => { const [uf, m] = k.split('|'); return [uf, m, v[0], v[1], v[2], v[3], v[4] || null, (C.interpretados || {})[k] || null]; }));
linhas.push('commit;', '');

fs.writeFileSync(path.join(raiz, 'privado/seed.sql'), linhas.join('\n'));
console.log('privado/seed.sql gerado:', linhas.length, 'blocos');
