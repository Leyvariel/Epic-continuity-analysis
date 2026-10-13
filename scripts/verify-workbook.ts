import { readFile } from 'node:fs/promises';
import { parseWorkbook } from '../server/import';
import { safeError } from '../server/errors';

const file = process.argv[2];
if (!file) { console.error('Использование: npm run verify:workbook -- /путь/к/файлу.xlsx'); process.exitCode = 1; }
else {
  try {
    const imported = parseWorkbook(await readFile(file), file);
    console.log(JSON.stringify({ source: imported.source, hfCount: imported.epics.length, keys: imported.epics.map(e => e.key), warnings: imported.warnings }, null, 2));
  } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
