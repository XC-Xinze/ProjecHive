// File type detection by extension.
// Returns one of: 'image' | 'document' | 'dataset'
export function detectFileType(fileName) {
  const ext = fileName?.split('.').pop()?.toLowerCase() || ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (DATASET_EXTS.has(ext)) return 'dataset'
  return 'document'
}

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'heic', 'avif',
])

const DATASET_EXTS = new Set([
  'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xlsx', 'xls', 'xlsm',
  'parquet', 'arrow', 'feather', 'orc',
  'npy', 'npz', 'h5', 'hdf5', 'mat',
  'sqlite', 'sqlite3', 'db', 'duckdb',
])

const MIME_MAP = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', html: 'text/html',
}

export function getMimeType(fileName) {
  const ext = fileName?.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'application/octet-stream'
}

// True for repo-relative paths (e.g. "assets/123-foo.pdf"), false for absolute URLs.
export function isUploadedAsset(url) {
  if (!url) return false
  return !/^([a-z]+:)?\/\//i.test(url) && !url.startsWith('mailto:')
}
