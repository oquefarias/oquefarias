import React, { useState, useMemo, useRef } from 'react';
import ExcelJS from 'exceljs';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Product, ProductImportItem, ProductImportResult, StoreSettings, isComboProduct } from '../../types';
import { api } from '../../services/api';

interface ImportProductsModalProps {
  isOpen: boolean;
  existingProducts: Product[];
  settings?: StoreSettings;
  onClose: () => void;
  onImported: () => void;
}

type FieldKey =
  | 'name'
  | 'category'
  | 'price'
  | 'costPrice'
  | 'stock'
  | 'minStock'
  | 'sku'
  | 'volume'
  | 'active';

const FIELD_DEFINITIONS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: 'name', label: 'Nome do Produto', required: true },
  { key: 'price', label: 'Preço de Venda', required: true },
  { key: 'costPrice', label: 'Preço de Custo' },
  { key: 'stock', label: 'Estoque' },
  { key: 'minStock', label: 'Estoque Mínimo' },
  { key: 'category', label: 'Categoria' },
  { key: 'sku', label: 'Código / EAN' },
  { key: 'volume', label: 'Medida / Unidade' },
  { key: 'active', label: 'Ativo / Status Venda' },
];

function normalizeHeader(val: unknown): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookupKey(val: unknown): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractCellString(cellVal: any): string {
  if (cellVal === null || cellVal === undefined) return '';
  if (typeof cellVal === 'object') {
    if ('result' in cellVal && cellVal.result !== undefined && cellVal.result !== null) {
      return String(cellVal.result).trim();
    }
    if ('richText' in cellVal && Array.isArray(cellVal.richText)) {
      return cellVal.richText.map((rt: any) => rt?.text || '').join('').trim();
    }
    if ('text' in cellVal && cellVal.text !== undefined) {
      return String(cellVal.text).trim();
    }
  }
  return String(cellVal).trim();
}

function parseMoneyBr(raw: unknown): number | null {
  if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  }
  let str = String(raw)
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (!str) return null;
  if (str.includes('.') && str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }
  const num = Number(str);
  if (Number.isNaN(num) || !Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function parseStockInt(raw: unknown, defaultVal: number): { valid: boolean; value: number } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { valid: true, value: defaultVal };
  }
  if (typeof raw === 'boolean') return { valid: false, value: 0 };
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0) return { valid: false, value: 0 };
    return { valid: true, value: raw };
  }
  let str = String(raw).trim();
  if (str.includes(',') && !str.includes('.')) {
    str = str.replace(',', '.');
  }
  const num = Number(str);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
    return { valid: false, value: 0 };
  }
  return { valid: true, value: num };
}

function parseActiveValue(raw: unknown): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  if (typeof raw === 'boolean') return raw;
  const k = normalizeLookupKey(raw);
  if (['nao', 'false', '0', 'inativo', 'pausado', 'desativado', 'n'].includes(k)) {
    return false;
  }
  return true;
}

function autoMapColumns(headers: string[]): Record<FieldKey, number> {
  const mapping: Record<FieldKey, number> = {
    name: -1,
    category: -1,
    price: -1,
    costPrice: -1,
    stock: -1,
    minStock: -1,
    sku: -1,
    volume: -1,
    active: -1,
  };

  headers.forEach((rawHeader, idx) => {
    const h = normalizeHeader(rawHeader);
    if (!h) return;

    // 1. Nome / Produto / Descrição
    if (
      mapping.name === -1 &&
      (h === 'nome' ||
        h === 'produto' ||
        h === 'descricao' ||
        h === 'nome do produto' ||
        h === 'descricao do produto' ||
        h.startsWith('nome ') ||
        h.startsWith('produto '))
    ) {
      mapping.name = idx;
      return;
    }

    // 2. Categoria / Grupo
    if (
      mapping.category === -1 &&
      (h === 'categoria' || h === 'grupo' || h.startsWith('categoria ') || h.startsWith('grupo '))
    ) {
      mapping.category = idx;
      return;
    }

    // 3. Preço Custo / Custo (check before Preço so "Preço Custo" maps to costPrice)
    if (
      mapping.costPrice === -1 &&
      (h === 'preco custo' ||
        h === 'preco de custo' ||
        h === 'custo' ||
        h === 'valor custo' ||
        h === 'valor de custo' ||
        h.includes('custo'))
    ) {
      mapping.costPrice = idx;
      return;
    }

    // 4. Preço Venda / Preço / Valor
    if (
      mapping.price === -1 &&
      (h === 'preco venda' ||
        h === 'preco de venda' ||
        h === 'preco' ||
        h === 'valor' ||
        h === 'valor venda' ||
        h === 'valor de venda' ||
        h.startsWith('preco'))
    ) {
      mapping.price = idx;
      return;
    }

    // 5. Estoque Mín / Estoque Mínimo (check before Estoque)
    if (
      mapping.minStock === -1 &&
      (h === 'estoque min' ||
        h === 'estoque minimo' ||
        h === 'qtd minima' ||
        h === 'minimo' ||
        (h.includes('estoque') && h.includes('min')))
    ) {
      mapping.minStock = idx;
      return;
    }

    // 6. Estoque / Quantidade / Qtd
    if (
      mapping.stock === -1 &&
      (h === 'estoque' ||
        h === 'estoque atual' ||
        h === 'quantidade' ||
        h === 'qtd' ||
        h === 'qtde' ||
        h === 'saldo')
    ) {
      mapping.stock = idx;
      return;
    }

    // 7. Código / Cód / EAN / Código de Barras
    if (
      mapping.sku === -1 &&
      (h === 'codigo' ||
        h === 'cod' ||
        h === 'ean' ||
        h === 'codigo de barras' ||
        h === 'cod barras' ||
        h === 'sku' ||
        h.includes('ean') ||
        h.includes('barras') ||
        h.startsWith('cod'))
    ) {
      mapping.sku = idx;
      return;
    }

    // 8. Medida / Unidade
    if (
      mapping.volume === -1 &&
      (h === 'medida' ||
        h === 'unidade' ||
        h === 'un' ||
        h === 'volume' ||
        h === 'embalagem' ||
        h.startsWith('medida') ||
        h.startsWith('unidade'))
    ) {
      mapping.volume = idx;
      return;
    }

    // 9. Status Venda / Ativo
    if (
      mapping.active === -1 &&
      (h === 'status venda' ||
        h === 'status de venda' ||
        h === 'ativo' ||
        h === 'status' ||
        h === 'situacao')
    ) {
      mapping.active = idx;
      return;
    }
  });

  return mapping;
}

interface PreviewRow {
  rowNumber: number;
  name: string;
  category: string;
  priceRaw: string;
  price: number | null;
  costPrice: number;
  stock: number;
  minStock: number;
  sku: string;
  volume: string;
  active: boolean;
  status: 'new' | 'existing' | 'error';
  statusLabel: string;
  errorReason?: string;
}

export const ImportProductsModal: React.FC<ImportProductsModalProps> = ({
  isOpen,
  existingProducts,
  settings,
  onClose,
  onImported,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<{ rowNumber: number; cells: string[] }[]>([]);
  const [columnMap, setColumnMap] = useState<Record<FieldKey, number>>({
    name: -1,
    category: -1,
    price: -1,
    costPrice: -1,
    stock: -1,
    minStock: -1,
    sku: -1,
    volume: -1,
    active: -1,
  });

  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<ProductImportResult | null>(null);

  const resetModalState = () => {
    setFileName('');
    setHeaders([]);
    setRawRows([]);
    setFileError('');
    setImportResult(null);
    setDuplicateMode('skip');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError('');
    setImportResult(null);

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setFileError('Formato inválido. Selecione apenas arquivos Excel (.xlsx).');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setFileError('O arquivo excede o tamanho máximo permitido de 2 MB.');
      return;
    }

    setIsParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        setFileError('A planilha está vazia ou não possui abas.');
        return;
      }

      let headerRowIndex = -1;
      let extractedHeaders: string[] = [];

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (headerRowIndex === -1) {
          const vals: string[] = [];
          const colCount = Math.max(row.cellCount, 15);
          for (let c = 1; c <= colCount; c++) {
            vals.push(extractCellString(row.getCell(c).value));
          }
          while (vals.length > 0 && !vals[vals.length - 1]) {
            vals.pop();
          }
          if (vals.some((v) => v !== '')) {
            headerRowIndex = rowNumber;
            extractedHeaders = vals.map((h, i) => h || `Coluna ${i + 1}`);
          }
        }
      });

      if (headerRowIndex === -1 || extractedHeaders.length === 0) {
        setFileError('Não foi possível encontrar o cabeçalho na planilha.');
        return;
      }

      const parsedDataRows: { rowNumber: number; cells: string[] }[] = [];
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber <= headerRowIndex) return;
        const cells: string[] = [];
        for (let c = 1; c <= extractedHeaders.length; c++) {
          cells.push(extractCellString(row.getCell(c).value));
        }
        if (cells.some((val) => val !== '')) {
          parsedDataRows.push({ rowNumber, cells });
        }
      });

      if (parsedDataRows.length === 0) {
        setFileError('A planilha não contém linhas de produtos abaixo do cabeçalho.');
        return;
      }

      if (parsedDataRows.length > 2000) {
        setFileError(
          `A planilha possui ${parsedDataRows.length} linhas. O limite máximo é de 2000 linhas por importação.`
        );
        return;
      }

      setFileName(file.name);
      setHeaders(extractedHeaders);
      setRawRows(parsedDataRows);
      setColumnMap(autoMapColumns(extractedHeaders));
    } catch (err: any) {
      console.error('Erro ao ler arquivo .xlsx:', err);
      setFileError('Não foi possível ler o arquivo .xlsx. Verifique se o arquivo não está corrompido.');
    } finally {
      setIsParsing(false);
    }
  };

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (rawRows.length === 0) return [];

    const existingNames = new Set<string>();
    const existingSkus = new Set<string>();
    const comboNames = new Set<string>();
    const comboSkus = new Set<string>();
    for (const p of existingProducts) {
      const n = normalizeLookupKey(p.name);
      const s = normalizeLookupKey(p.sku);
      const isCombo = isComboProduct(p.id, settings);
      if (n) {
        existingNames.add(n);
        if (isCombo) comboNames.add(n);
      }
      if (s) {
        existingSkus.add(s);
        if (isCombo) comboSkus.add(s);
      }
    }

    const seenNamesInSheet = new Set<string>();
    const seenSkusInSheet = new Set<string>();

    return rawRows.map(({ rowNumber, cells }) => {
      const getVal = (field: FieldKey) => {
        const idx = columnMap[field];
        return idx >= 0 && idx < cells.length ? cells[idx] : '';
      };

      const name = getVal('name').trim();
      const category = getVal('category').trim() || 'cervejas';
      const priceRaw = getVal('price').trim();
      const costRaw = getVal('costPrice').trim();
      const stockRaw = getVal('stock').trim();
      const minStockRaw = getVal('minStock').trim();
      const sku = getVal('sku').trim();
      const volume = getVal('volume').trim();
      const activeRaw = getVal('active').trim();

      const price = parseMoneyBr(priceRaw);
      const costParsed = costRaw ? parseMoneyBr(costRaw) : 0;
      const stockParsed = parseStockInt(stockRaw, 0);
      const minStockParsed = parseStockInt(minStockRaw, 10);
      const active = parseActiveValue(activeRaw);

      const errorReasons: string[] = [];
      if (!name) {
        errorReasons.push('Sem nome');
      }
      if (price === null || price <= 0) {
        errorReasons.push('Preço inválido ou <= 0');
      }
      if (costParsed === null || costParsed < 0) {
        errorReasons.push('Custo inválido ou negativo');
      }
      if (!stockParsed.valid) {
        errorReasons.push('Estoque negativo ou não inteiro');
      }
      if (!minStockParsed.valid) {
        errorReasons.push('Estoque mín. negativo ou não inteiro');
      }

      if (errorReasons.length > 0) {
        return {
          rowNumber,
          name: name || '—',
          category,
          priceRaw,
          price,
          costPrice: costParsed ?? 0,
          stock: stockParsed.value,
          minStock: minStockParsed.value,
          sku,
          volume,
          active,
          status: 'error',
          statusLabel: 'Erro',
          errorReason: errorReasons.join(', '),
        };
      }

      const nameKey = normalizeLookupKey(name);
      const skuKey = sku ? normalizeLookupKey(sku) : '';

      const matchesCombo =
        comboNames.has(nameKey) || (skuKey !== '' && comboSkus.has(skuKey));

      const alreadyExists =
        matchesCombo ||
        existingNames.has(nameKey) ||
        (skuKey !== '' && existingSkus.has(skuKey)) ||
        seenNamesInSheet.has(nameKey) ||
        (skuKey !== '' && seenSkusInSheet.has(skuKey));

      seenNamesInSheet.add(nameKey);
      if (skuKey) seenSkusInSheet.add(skuKey);

      if (alreadyExists) {
        return {
          rowNumber,
          name,
          category,
          priceRaw,
          price,
          costPrice: costParsed ?? 0,
          stock: stockParsed.value,
          minStock: minStockParsed.value,
          sku,
          volume,
          active,
          status: 'existing',
          statusLabel: matchesCombo
            ? 'Combo (sempre pulado na planilha)'
            : 'Já existe (mesmo nome ou código)',
        };
      }

      return {
        rowNumber,
        name,
        category,
        priceRaw,
        price,
        costPrice: costParsed ?? 0,
        stock: stockParsed.value,
        minStock: minStockParsed.value,
        sku,
        volume,
        active,
        status: 'new',
        statusLabel: 'Novo',
      };
    });
  }, [rawRows, columnMap, existingProducts, settings]);

  const counts = useMemo(() => {
    let newCount = 0;
    let existingCount = 0;
    let errorCount = 0;
    for (const r of previewRows) {
      if (r.status === 'new') newCount++;
      else if (r.status === 'existing') existingCount++;
      else errorCount++;
    }
    const actionableCount = newCount + (duplicateMode === 'update' ? existingCount : 0);
    return { newCount, existingCount, errorCount, actionableCount };
  }, [previewRows, duplicateMode]);

  if (!isOpen) return null;

  const missingRequiredMapping = columnMap.name === -1 || columnMap.price === -1;

  const handleImportSubmit = async () => {
    if (isImporting || missingRequiredMapping) return;

    // Rows with errors are never sent
    const validRowsToSend: ProductImportItem[] = previewRows
      .filter((r) => r.status === 'new' || r.status === 'existing')
      .map((r) => ({
        rowNumber: r.rowNumber,
        name: r.name,
        category: r.category,
        price: r.price ?? 0,
        costPrice: r.costPrice,
        stock: r.stock,
        minStock: r.minStock,
        sku: r.sku,
        volume: r.volume,
        active: r.active,
      }));

    if (validRowsToSend.length === 0) {
      setFileError('Não há linhas válidas para importar.');
      return;
    }

    setIsImporting(true);
    setFileError('');
    try {
      const res = await api.importAdminProducts(validRowsToSend, duplicateMode);
      setImportResult(res);
      onImported();
    } catch (err: any) {
      setFileError(err.message || 'Erro ao importar produtos.');
    } finally {
      setIsImporting(false);
    }
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-5xl w-full shadow-2xl border border-neutral-200 overflow-hidden my-4 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-neutral-900 text-white px-5 py-4 flex items-center justify-between border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg">Importar planilha (.xlsx)</h3>
              <p className="text-xs text-neutral-400">
                Importe seus produtos em lote a partir do Excel (máx. 2 MB e 2000 linhas)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
          {fileError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-800 font-bold flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{fileError}</span>
            </div>
          )}

          {/* Import Result Summary */}
          {importResult && (
            <div className="p-5 bg-emerald-50 border-2 border-emerald-300 rounded-2xl space-y-4">
              <div className="flex items-center gap-2.5 text-emerald-950">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="font-black text-base">Importação Concluída!</h4>
                  <p className="text-xs text-emerald-800 font-medium">
                    A lista de produtos do estoque já foi atualizada.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3 rounded-xl border border-emerald-200">
                  <span className="text-[11px] text-neutral-500 font-bold block">Criados (Novos)</span>
                  <span className="text-xl font-black text-emerald-700">{importResult.created}</span>
                </div>
                <div className="bg-white p-3 rounded-xl border border-blue-200">
                  <span className="text-[11px] text-neutral-500 font-bold block">Atualizados</span>
                  <span className="text-xl font-black text-blue-700">{importResult.updated}</span>
                </div>
                <div className="bg-white p-3 rounded-xl border border-neutral-200">
                  <span className="text-[11px] text-neutral-500 font-bold block">Pulados (Já existiam)</span>
                  <span className="text-xl font-black text-neutral-700">{importResult.skipped}</span>
                </div>
                <div className="bg-white p-3 rounded-xl border border-red-200">
                  <span className="text-[11px] text-neutral-500 font-bold block">Com erro (Ignorados)</span>
                  <span className="text-xl font-black text-red-600">
                    {importResult.errors.length + counts.errorCount}
                  </span>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="bg-white p-3 rounded-xl border border-red-200 space-y-1 max-h-40 overflow-y-auto">
                  <p className="font-bold text-red-800">Erros reportados pelo servidor:</p>
                  {importResult.errors.map((err, i) => (
                    <p key={i} className="text-[11px] text-red-700">
                      Linha {err.rowNumber} {err.name ? `(${err.name})` : ''}: {err.reason}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={resetModalState}
                  className="px-4 py-2.5 bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 font-bold rounded-xl cursor-pointer"
                >
                  Importar outra planilha
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl cursor-pointer"
                >
                  Concluir e Fechar
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Upload File */}
          {!importResult && (
            <div className="p-4 bg-neutral-50 border-2 border-dashed border-neutral-300 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Upload className="w-8 h-8 text-amber-600 shrink-0" />
                <div>
                  <p className="font-black text-sm text-neutral-900">
                    {fileName ? `Arquivo: ${fileName}` : 'Selecione sua planilha Excel (.xlsx)'}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    Colunas reconhecidas automaticamente: Nome, Categoria, Preço Venda, Preço Custo, Estoque, Estoque Mín, Código/EAN, Medida e Ativo.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isParsing}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  {isParsing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Lendo planilha...</span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>{fileName ? 'Trocar arquivo (.xlsx)' : 'Escolher arquivo (.xlsx)'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Column Mapping & Duplicate Mode */}
          {!importResult && headers.length > 0 && (
            <>
              <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="font-black text-neutral-900 text-sm">
                    Mapeamento das Colunas da Planilha
                  </h4>
                  <span className="text-[11px] text-neutral-500 font-semibold">
                    Ajuste caso alguma coluna não tenha sido reconhecida (* obrigatórios)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {FIELD_DEFINITIONS.map((field) => {
                    const selectedIdx = columnMap[field.key];
                    const isMissingRequired = field.required && selectedIdx === -1;
                    return (
                      <div key={field.key}>
                        <label className="font-bold text-neutral-700 block mb-1 text-[11px]">
                          {field.label} {field.required && <span className="text-red-600">*</span>}
                        </label>
                        <select
                          value={selectedIdx}
                          onChange={(e) =>
                            setColumnMap((prev) => ({
                              ...prev,
                              [field.key]: Number(e.target.value),
                            }))
                          }
                          className={`w-full px-2.5 py-2 rounded-xl border text-xs font-semibold outline-none ${
                            isMissingRequired
                              ? 'border-red-500 bg-red-50 text-red-900'
                              : 'border-neutral-300 bg-white text-neutral-900'
                          }`}
                        >
                          <option value={-1}>— Não importar / Ignorar —</option>
                          {headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Duplicate Products Handling */}
              <div className="bg-amber-50/70 p-4 rounded-2xl border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="font-black text-amber-950 block text-xs">
                    Para produtos que já existem (mesmo nome ou código):
                  </span>
                  <span className="text-[11px] text-amber-800">
                    Escolha se deseja pular ou atualizar o preço de venda, custo e estoque.
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={`px-3 py-2 rounded-xl border font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors ${
                      duplicateMode === 'skip'
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-700 border-neutral-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicateMode"
                      checked={duplicateMode === 'skip'}
                      onChange={() => setDuplicateMode('skip')}
                      className="sr-only"
                    />
                    <span>Pular</span>
                  </label>

                  <label
                    className={`px-3 py-2 rounded-xl border font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors ${
                      duplicateMode === 'update'
                        ? 'bg-amber-500 text-neutral-950 border-amber-600 font-black'
                        : 'bg-white text-neutral-700 border-neutral-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicateMode"
                      checked={duplicateMode === 'update'}
                      onChange={() => setDuplicateMode('update')}
                      className="sr-only"
                    />
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Atualizar preço, custo e estoque</span>
                  </label>
                </div>
              </div>

              {/* Status Counters & Preview Table */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-black">
                      Novos: {counts.newCount}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-black">
                      Já existem: {counts.existingCount}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-800 font-black">
                      Com erro (não serão salvos): {counts.errorCount}
                    </span>
                  </div>
                  <span className="text-neutral-500 font-semibold">
                    Total lido: {previewRows.length} linhas
                  </span>
                </div>

                <div className="border border-neutral-200 rounded-2xl overflow-hidden">
                  <div className="max-h-72 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-left text-xs text-neutral-700">
                      <thead className="bg-neutral-100 border-b border-neutral-200 text-neutral-600 font-bold uppercase sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3">Linha</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Nome</th>
                          <th className="py-2.5 px-3">Categoria</th>
                          <th className="py-2.5 px-3">Venda</th>
                          <th className="py-2.5 px-3">Custo</th>
                          <th className="py-2.5 px-3">Estoque</th>
                          <th className="py-2.5 px-3">Cód/EAN</th>
                          <th className="py-2.5 px-3">Medida</th>
                          <th className="py-2.5 px-3">Ativo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {previewRows.map((row) => (
                          <tr
                            key={row.rowNumber}
                            className={
                              row.status === 'error'
                                ? 'bg-red-50/60'
                                : row.status === 'existing'
                                ? 'bg-amber-50/40'
                                : 'bg-white'
                            }
                          >
                            <td className="py-2 px-3 font-mono text-neutral-500">#{row.rowNumber}</td>
                            <td className="py-2 px-3">
                              {row.status === 'new' && (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-black text-[11px]">
                                  Novo
                                </span>
                              )}
                              {row.status === 'existing' && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-bold text-[11px]">
                                  Já existe (mesmo nome ou código)
                                </span>
                              )}
                              {row.status === 'error' && (
                                <div>
                                  <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-800 font-black text-[11px]">
                                    Erro
                                  </span>
                                  {row.errorReason && (
                                    <span className="block text-[10px] font-bold text-red-600 mt-0.5">
                                      {row.errorReason}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-3 font-bold text-neutral-900">{row.name}</td>
                            <td className="py-2 px-3">{row.category}</td>
                            <td className="py-2 px-3 font-mono font-bold">
                              {row.price !== null ? formatCurrency(row.price) : row.priceRaw || '—'}
                            </td>
                            <td className="py-2 px-3 font-mono text-neutral-600">
                              {formatCurrency(row.costPrice)}
                            </td>
                            <td className="py-2 px-3 font-mono font-bold">{row.stock} un</td>
                            <td className="py-2 px-3 font-mono text-[11px]">{row.sku || '—'}</td>
                            <td className="py-2 px-3">{row.volume || '—'}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  row.active
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-neutral-200 text-neutral-600'
                                }`}
                              >
                                {row.active ? 'Sim' : 'Não'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!importResult && (
          <div className="px-5 py-4 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2.5 bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300 font-bold rounded-xl text-xs cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleImportSubmit}
              disabled={
                isImporting ||
                missingRequiredMapping ||
                previewRows.length === 0 ||
                counts.actionableCount === 0
              }
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black rounded-xl text-xs flex items-center gap-2 shadow-md cursor-pointer"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Importando produtos...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Importar {counts.actionableCount} produtos</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
