const crypto = require('crypto');
const { ensureSchema } = require('./_database');
const { isAuthenticated } = require('./_auth');

const PROJECT_ID = 'campanha-hengst';
const MAX_RECORDS = 10000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function text(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const source = String(value ?? '').trim().replace(/\s/g, '');
  if (!source) return 0;
  const normalized = source.includes(',') ? source.replace(/\./g, '').replace(',', '.') : source;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : NaN;
}

function isoDate(value) {
  const source = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return '';
  const date = new Date(`${source}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== source ? '' : source;
}

function fingerprint(record) {
  const source = [record.documento, record.requisicao, record.codigo, record.data, record.nome,
    record.quantidade.toFixed(4), record.valor.toFixed(2)].join('|').toLowerCase();
  return crypto.createHash('sha256').update(source).digest('hex');
}

function issue(index, type, record, reason, severity = 'error', action = 'discarded') {
  return {
    index,
    type,
    documento: text(record?.documento),
    vendedor: text(record?.nome),
    filial: text(record?.filial),
    produto: text(record?.produto),
    valor: Number(record?.valor || 0),
    severity,
    action,
    reason
  };
}

function normalizeRecord(input) {
  return {
    nome: text(input.nome),
    filial: text(input.filial),
    marca: 'HENGST',
    quantidade: number(input.quantidade),
    valor: number(input.valor),
    pedido: text(input.pedido),
    requisicao: text(input.pedido),
    documento: text(input.documento),
    cliente: text(input.cliente) || 'Cliente não identificado',
    produto: text(input.produto),
    codigoProduto: text(input.codigoProduto),
    codigo: text(input.codigoProduto),
    data: isoDate(input.data),
    origem: 'JACSYS',
    arquivo: 'Simulação JACSYS',
    aba: 'API_JACSYS_SIMULACAO',
    linha: 0
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const startedAt = Date.now();
  let sql;
  try {
    if (Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'A simulação ultrapassa o limite de 4 MB.' });
    }
    sql = await ensureSchema();
    const payload = req.body?.payload;
    const periodStart = isoDate(req.body?.periodStart);
    const periodEnd = isoDate(req.body?.periodEnd);
    const brandCode = text(req.body?.brandCode, 80);
    if (!periodStart || !periodEnd || periodStart > periodEnd) throw new Error('Informe um período válido para a simulação.');
    if (!brandCode) throw new Error('Informe o código interno da marca HENGST.');
    if (!payload || payload.type !== 'hengst-jacsys-simulation' || Number(payload.version) !== 1) {
      throw new Error('O JSON não segue o formato de simulação JACSYS versão 1.');
    }
    if (!Array.isArray(payload.records) || !payload.records.length) throw new Error('A simulação não contém registros.');
    if (payload.records.length > MAX_RECORDS) throw new Error(`A simulação excede ${MAX_RECORDS} registros.`);

    const issues = [];
    const valid = [];
    const seen = new Set();
    let grossValue = 0;
    let grossQuantity = 0;
    let discardedValue = 0;
    let discardedQuantity = 0;

    payload.records.forEach((input, index) => {
      const record = normalizeRecord(input || {});
      record.linha = index + 1;
      if (Number.isFinite(record.valor)) grossValue += record.valor;
      if (Number.isFinite(record.quantidade)) grossQuantity += record.quantidade;
      const errors = [];
      if (!record.nome) errors.push(['MISSING_SELLER', 'Registro sem vendedor.']);
      if (!record.filial) errors.push(['MISSING_BRANCH', 'Registro sem filial.']);
      if (text(input?.marca) && text(input.marca).toUpperCase() !== 'HENGST') errors.push(['BRAND_MISMATCH', 'Registro informado com marca diferente de HENGST.']);
      if (!record.documento) errors.push(['MISSING_DOCUMENT', 'Registro sem documento.']);
      if (!record.codigo) errors.push(['MISSING_PRODUCT_CODE', 'Produto sem código.']);
      if (!record.data) errors.push(['INVALID_DATE', 'Data ausente ou inválida.']);
      else if (record.data < periodStart || record.data > periodEnd) errors.push(['OUTSIDE_PERIOD', 'Data fora do período consultado.']);
      if (!Number.isFinite(record.valor)) errors.push(['INVALID_VALUE', 'Valor não numérico.']);
      else if (record.valor < 0) errors.push(['NEGATIVE_VALUE', 'Valor negativo.']);
      else if (record.valor === 0) errors.push(['ZERO_VALUE', 'Valor zerado.']);
      if (!Number.isFinite(record.quantidade)) errors.push(['INVALID_QUANTITY', 'Quantidade não numérica.']);
      else if (record.quantidade < 0) errors.push(['NEGATIVE_QUANTITY', 'Quantidade negativa.']);
      else if (record.quantidade === 0) errors.push(['ZERO_QUANTITY', 'Quantidade zerada.']);

      if (!errors.length) {
        const key = fingerprint(record);
        if (seen.has(key)) errors.push(['DUPLICATE', 'Registro duplicado dentro da consulta.']);
        else seen.add(key);
      }
      if (errors.length) {
        errors.forEach(([type, reason]) => issues.push(issue(index, type, record, reason)));
        if (Number.isFinite(record.valor)) discardedValue += record.valor;
        if (Number.isFinite(record.quantidade)) discardedQuantity += record.quantidade;
        return;
      }
      valid.push(record);
    });

    const totalValue = valid.reduce((sum, row) => sum + row.valor, 0);
    const totalQuantity = valid.reduce((sum, row) => sum + row.quantidade, 0);
    const issueCounts = issues.reduce((counts, item) => {
      counts[item.type] = (counts[item.type] || 0) + 1;
      return counts;
    }, {});
    const summary = {
      received: payload.records.length,
      valid: valid.length,
      discarded: payload.records.length - valid.length,
      duplicates: issues.filter(item => item.type === 'DUPLICATE').length,
      cancelled: 0,
      returns: 0,
      grossValue,
      discardedValue,
      validValue: totalValue,
      grossQuantity,
      discardedQuantity,
      validQuantity: totalQuantity,
      differenceValue: grossValue - totalValue,
      differenceQuantity: grossQuantity - totalQuantity,
      issueCounts,
      durationMs: Date.now() - startedAt
    };

    const historyRows = await sql`
      insert into campaign_update_history
        (project_id, origin, period_start, period_end, record_count, valid_count, discarded_count,
         total_value, total_quantity, duration_ms, result, message, metadata)
      values
        (${PROJECT_ID}, 'JACSYS_SIMULATION', ${periodStart}, ${periodEnd}, ${summary.received},
         ${summary.valid}, ${summary.discarded}, ${summary.validValue}, ${summary.validQuantity},
         ${summary.durationMs}, 'success', 'Simulação JACSYS validada; aguardando aplicação pelo administrador.',
         ${sql.json({ brand: 'HENGST', brandCode, issues: issues.slice(0, 500), summary })})
      returning id, created_at::text as created_at
    `;

    return res.status(200).json({
      ok: true,
      mode: 'simulation',
      brand: { name: 'HENGST', internalCode: brandCode },
      period: { start: periodStart, end: periodEnd },
      records: valid,
      issues: issues.slice(0, 1000),
      issuesTruncated: issues.length > 1000,
      summary,
      historyId: historyRows[0].id,
      processedAt: historyRows[0].created_at
    });
  } catch (error) {
    console.error('Falha na simulação JACSYS:', error);
    try {
      if (sql) await sql`
        insert into campaign_update_history
          (project_id, origin, duration_ms, result, message, metadata)
        values
          (${PROJECT_ID}, 'JACSYS_SIMULATION', ${Date.now() - startedAt}, 'error',
           ${String(error.message || 'Falha na simulação.').slice(0, 1000)}, ${sql.json({ mode: 'simulation' })})
      `;
    } catch (historyError) {
      console.error('Falha ao registrar erro JACSYS:', historyError);
    }
    return res.status(400).json({ error: error.message || 'Não foi possível validar a simulação JACSYS.' });
  }
};
