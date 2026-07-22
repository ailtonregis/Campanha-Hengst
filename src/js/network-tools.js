(function initializeHengstNetworkTools(global) {
  'use strict';

  function parseJsonFile(file, maxBytes = 4 * 1024 * 1024) {
    if (!file) return Promise.reject(new Error('Selecione um arquivo JSON.'));
    if (!/\.json$/i.test(file.name)) return Promise.reject(new Error('O arquivo precisa usar a extensão .json.'));
    if (file.size > maxBytes) return Promise.reject(new Error('O arquivo ultrapassa o limite de 4 MB.'));
    return file.text().then(text => {
      try { return JSON.parse(text); }
      catch { throw new Error('O arquivo não contém um JSON válido.'); }
    });
  }

  function validateBackup(backup) {
    if (!backup || backup.type !== 'hengst-panel-backup' || Number(backup.version) !== 1) {
      throw new Error('Formato ou versão do backup inválidos.');
    }
    if (!backup.data || typeof backup.data !== 'object' || !Array.isArray(backup.data.rawRows)) {
      throw new Error('O backup não contém os dados obrigatórios do painel.');
    }
    if (backup.data.historicalRows && !Array.isArray(backup.data.historicalRows)) {
      throw new Error('A base histórica do backup é inválida.');
    }
    return backup;
  }

  function validateJacsysSimulation(payload) {
    if (!payload || payload.type !== 'hengst-jacsys-simulation' || Number(payload.version) !== 1) {
      throw new Error('O JSON não segue o formato hengst-jacsys-simulation versão 1.');
    }
    if (!Array.isArray(payload.records) || !payload.records.length) {
      throw new Error('O JSON de simulação não possui registros.');
    }
    return payload;
  }

  function downloadJson(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes || 0));
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  global.HengstNetworkTools = { parseJsonFile, validateBackup, validateJacsysSimulation, downloadJson, formatBytes };
})(window);
