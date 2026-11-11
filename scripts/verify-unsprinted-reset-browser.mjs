// Real Chrome verification. Mutations target only the disposable fixture on 4335.
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const out=path.resolve('docs/sdd/changes/archive/2026/LOCAL-20261109-01-unsprinted-task-activity/evidence/visual');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const shot=async name=>page.screenshot({path:path.join(out,name+'.png')});
const reset=()=>page.getByRole('button',{name:'Сбросить все данные',exact:true});
try{
 await page.goto('http://127.0.0.1:4335',{waitUntil:'networkidle'});
 assert.equal(await page.locator('.epic-row [data-metric="sprintFocus"]').textContent(),'11,00');assert.equal(await page.locator('.epic-sprint-gap').count(),2);
 await page.getByRole('button',{name:'Раскрыть A-1',exact:true}).click();await page.getByRole('button',{name:'Раскрыть A-2',exact:true}).click();
 for(const zoom of ['День','Неделя','Месяц']){
  await page.getByRole('button',{name:zoom,exact:true}).click();await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await page.locator('.timeline-scroll').evaluate(el=>{el.scrollLeft=350;el.scrollTop=30;});
  assert.equal(await page.locator('.related-row [data-metric]').count(),0);
  assert.ok(await page.locator('.epic-row').evaluate(row=>{const cell=row.querySelector('[data-metric="sprintFocus"]').getBoundingClientRect(),gap=row.querySelector('.epic-sprint-gap').getBoundingClientRect();return !!document.elementFromPoint(cell.x+cell.width/2,gap.y+2)?.closest('.left-area');}),'Gap must stay behind sticky numeric columns');
  await shot('01-mixed-'+zoom);
 }
 checks.push('Mixed: 3 exact days cover 3 of 14; two gaps; descendants, day/week/month and scrolling');
 await page.locator('.epic-row [data-metric="sprintFocus"]').click();await page.getByText('Работа без спринтов (1)',{exact:true}).click();assert.ok((await page.getByRole('dialog').textContent()).includes('TEXT-3'));await shot('02-exact-details');await page.keyboard.press('Escape');
 await page.setViewportSize({width:800,height:1000});await reset().click();await shot('03-confirm-narrow');await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await page.locator('.epic-row').count(),1);
 await page.setViewportSize({width:1440,height:1000});
 await page.route('**/api/reset',r=>r.fulfill({status:500,json:{error:{code:'CACHE_RESET',message:'Проверочная ошибка очистки'}}}));await reset().click();await page.getByRole('button',{name:'Сбросить данные',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.epic-row').count(),1);await shot('04-reset-error');await page.unroute('**/api/reset');
 await reset().click();await page.getByRole('button',{name:'Сбросить данные',exact:true}).click();await page.getByText('Данные сброшены. Выберите источник для нового анализа.',{exact:true}).waitFor();assert.equal(await page.locator('.epic-row').count(),0);await shot('05-reset-empty');await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.epic-row').count(),0);assert.equal((await (await page.request.get('http://127.0.0.1:4335/api/dataset')).json()).dataset,null);
 checks.push('Reset: cancel, narrow modal, server error, successful deletion and empty reload on disposable cache only');
 const workbook=await (await page.request.get('http://127.0.0.1:4335/api/test-workbook')).body();await page.getByLabel('Источник истории файла').selectOption('file');await page.getByLabel('Файл CSV или XLSX').setInputFiles({name:'new-analysis.xlsx',mimeType:'application/octet-stream',buffer:workbook});await page.locator('.epic-row').first().waitFor();await page.reload({waitUntil:'networkidle'});await page.locator('.epic-row').first().waitFor();await shot('06-new-import');checks.push('New offline workbook imports and persists after reset');
 const exact=await (await page.request.get('http://127.0.0.1:4335/api/test-fixture')).json();await page.route('**/api/dataset',r=>r.fulfill({json:exact}));await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.epic-row [data-metric="sprintFocus"]').textContent(),'26,00');await page.locator('.epic-row [data-metric="sprintFocus"]').click();assert.ok((await page.getByRole('dialog').textContent()).includes('Весь цикл: все задачи без спринтов'));await page.getByText('Работа без спринтов (1)',{exact:true}).click();await shot('07-whole-cycle');await page.keyboard.press('Escape');await page.unroute('**/api/dataset');checks.push('Full cycle without sprints: 29 days minus 3 active = 26 days; exact sources visible');
 // Main application is strictly read-only in this script.
 await page.goto('http://127.0.0.1:4317',{waitUntil:'networkidle'});await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('HOTELS-13142');assert.equal(await page.locator('.epic-row').count(),1);assert.equal(await page.locator('.epic-row [data-metric="sprintFocus"]').textContent(),'13,93');assert.equal(await page.locator('.epic-sprint-gap').count(),3);
 await page.getByRole('button',{name:'Раскрыть HOTELS-13142',exact:true}).click();await page.getByRole('button',{name:'Месяц',exact:true}).click();await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await page.locator('.epic-sprint-gap').nth(1).evaluate(el=>{const scroll=el.closest('.timeline-scroll'),width=el.closest('.epic-row').querySelector('.left-area').getBoundingClientRect().width;scroll.scrollLeft=width+parseFloat(el.style.left)-350;scroll.scrollTop=0;});await shot('08-hotels-case');checks.push('Main saved HOTELS-13142: 13.93 days, August realization gap visible; no main reset/import');
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'browser-report.json'),JSON.stringify({status:'passed',checks,errors},null,2));console.log(JSON.stringify({status:'passed',checks:checks.length}));
}catch(e){await shot('failure');await writeFile(path.join(out,'browser-failure.json'),JSON.stringify({error:String(e),checks,errors},null,2));console.error(e);process.exitCode=1;}
finally{await browser.close();}
