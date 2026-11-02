import {chromium} from '/Users/leyva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const out=path.dirname(fileURLToPath(import.meta.url));
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const shot=async name=>{await page.screenshot({path:`${out}/${name}.png`,fullPage:true});};
const resetScroll=async(left=0,top=0)=>page.locator('.timeline-scroll').evaluate((el,{left,top})=>{el.scrollLeft=left;el.scrollTop=top;},{left,top});
try {
 await page.goto('http://127.0.0.1:4332/',{waitUntil:'networkidle'});await page.locator('.epic-row').first().waitFor();
 const columns=await page.locator('.timeline-header .metric-grid button').allTextContents();assert.equal(await page.locator('.epic-row').count(),8);
 for(const [key,ttm,free] of [['HOTELS-1','15,00','15,00'],['HOTELS-2','15,00','5,00'],['HOTELS-3','15,00','11,00']]){
  const row=page.locator(`.epic-row[data-issue-key="${key}"]`);assert.equal(await row.locator('[data-metric="ttm"]').textContent(),ttm);assert.equal(await row.locator('[data-metric="ttmWithoutFlag"]').textContent(),free);
 }
 await shot('01-wide-table');checks.push('Значения 15/15, 15/5, 15/11; полный набор колонок');
 await page.getByLabel('Сортировка',{exact:true}).selectOption('ttmWithoutFlag');
 for(let i=0;i<2;i++){
  const order=await page.locator('.epic-row').evaluateAll(rows=>rows.map(r=>r.dataset.issueKey));assert.deepEqual(order.slice(-2),['HOTELS-6','HOTELS-7']);
  await page.getByLabel('Изменить направление сортировки',{exact:true}).click();
 }
 checks.push('Неизвестные значения последними при обоих направлениях сортировки');
 await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('HOTELS-5');
 assert.deepEqual(await page.locator('.timeline-header .metric-grid button').allTextContents(),columns.map(s=>s.replace('↓','')) .map((s,i)=>i===2?s+'↓':s));
 await resetScroll();
 await page.getByRole('button',{name:'Раскрыть HOTELS-5',exact:true}).click({timeout:3000});
 assert.equal(await page.locator('.related-row').count(),200);
 await page.getByRole('button',{name:'Раскрыть DELIVERY-1',exact:true}).click();
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();assert.equal(await page.locator('.related-row').count(),203);
 const task=page.locator('.related-row[data-issue-key="TASK-1"]');
 assert.equal(await task.locator('[data-metric="open"]').textContent(),'3,00');assert.equal(await task.locator('[data-metric="ttm"]').textContent(),'—');
 await resetScroll();await shot('02-expanded-own-durations');await resetScroll(1100);await shot('03-horizontal-scroll');
 const header=await page.locator('.timeline-header [aria-label="Сортировать: Релиз"]').boundingBox();
 const cell=await page.locator('.related-row[data-issue-key="TASK-1"] [data-metric="release"]').boundingBox();assert.ok(Math.abs(header.x-cell.x)<1);
 checks.push('Раскрытие двух уровней, 200→203 строки, собственные числа, выравнивание колонок при прокрутке');
 await resetScroll();await page.getByRole('button',{name:'Свернуть HOTELS-5',exact:true}).click();assert.equal(await page.locator('.related-row').count(),0);
 await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('HOTELS-1');
 for(const [label,pixels] of [['День',26],['Неделя',8],['Месяц',3]]){
  await page.getByRole('button',{name:label,exact:true}).click();
  const interval=page.locator('.epic-row .status-segment[title^="[HF] Отложено"]');
  assert.equal(await interval.evaluate(el=>parseFloat(el.style.width)),60*pixels);assert.match(await interval.getAttribute('title'),/Не входит в TTM/);
  await resetScroll(1200);await shot(`04-calendar-${pixels}`);
 }
 checks.push('День/неделя/месяц: 60 суток Отложено имеют точную ширину, история не сжимается');
 await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('HOTELS-3');await resetScroll();
 const title=page.locator('.epic-row .epic-title');await title.click();
 const dialog=page.getByRole('dialog');assert.match(await dialog.textContent(),/Флаг на учитываемом времени TTM/);await shot('05-metric-details');
 await page.keyboard.press('Shift+Tab');assert.equal(await dialog.locator('summary').last().evaluate(el=>document.activeElement===el),true);
 await page.keyboard.press('Tab');assert.equal(await dialog.locator('a').first().evaluate(el=>document.activeElement===el),true);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await title.evaluate(el=>document.activeElement===el),true);
 await page.getByRole('button',{name:'Правила расчёта',exact:true}).click();await shot('06-calculation-rules');await page.locator('.overlay').click({position:{x:8,y:8}});assert.equal(await page.getByRole('dialog').count(),0);
 checks.push('Детали, правила, Escape, фокус и закрытие по фону');
 await page.getByLabel('Источник длительностей',{exact:true}).selectOption('excel');await resetScroll();
 assert.equal(await page.locator('.epic-row [data-metric="ttm"]').textContent(),'75,00');assert.equal(await page.locator('.epic-row [data-metric="ttmWithoutFlag"]').textContent(),'—');
 assert.equal(await page.locator('.composition-segment').count(),3);assert.match(await page.locator('.composition-plot').getAttribute('title'),/Отложено:[\s\S]*Реализация:[\s\S]*Релиз:/);await shot('07-excel-composition');
 checks.push('Excel: исходный TTM 75, отдельные этапы, нет выдуманного TTM без флага');
 await page.getByLabel('Источник длительностей',{exact:true}).selectOption('history');await page.setViewportSize({width:800,height:1000});await resetScroll();await shot('08-narrow-table');
 await resetScroll(1350);await shot('09-narrow-calendar');
 const headingBox=await page.locator('.epic-heading').boundingBox(), tableBox=await page.locator('.timeline-scroll').boundingBox();assert.ok(headingBox.x>=tableBox.x-2,`Закреплённое название обрезано: ${headingBox.x} < ${tableBox.x}`);
 assert.ok(await page.locator('.timeline-scroll').evaluate(el=>el.scrollWidth>el.clientWidth));
 checks.push('Узкое окно 800 px: доступна горизонтальная и вертикальная прокрутка');
 await page.setViewportSize({width:1440,height:1100});await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('HOTELS-7');await resetScroll(1200);await shot('10-unknown-ttm-known-stages');
 // Separate synthetic UI states exercise diagnostics and a replacement dataset.
 const response=await (await page.request.get('http://127.0.0.1:4332/api/dataset')).json();
 const variant=structuredClone(response);variant.dataset.id='expanded-status-ui-edges';
 const graph=variant.dataset.hierarchy;
 graph.edges.push({parent:'HOTELS-7',child:'HOTELS-7'});
 const bad=structuredClone(graph.nodes['TASK-1']);bad.id=bad.key='BAD-1';bad.title='Недоступная дочерняя история';bad.history=undefined;bad.historyCoverage='unavailable';
 bad.timeline={state:'unavailable',intervals:[],start:null,end:null,closed:false,terminalStatus:null,closureSource:null,warnings:[{code:'HISTORY_UNAVAILABLE',message:'История дочернего объекта недоступна',severity:'error'}]};
 graph.nodes['BAD-1']=bad;graph.edges.push({parent:'HOTELS-6',child:'BAD-1'});
 await page.route('**/api/dataset',route=>route.fulfill({json:variant}));await page.reload({waitUntil:'networkidle'});
 await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('HOTELS-6');await page.getByRole('button',{name:'Раскрыть HOTELS-6',exact:true}).click();
 assert.equal(await page.locator('.related-row [data-metric="planned"]').textContent(),'—');await shot('11-unknown-child');
 await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('HOTELS-7');await page.getByRole('button',{name:'Раскрыть HOTELS-7',exact:true}).click();assert.match(await page.locator('.hierarchy-notice').textContent(),/цикл/);await shot('12-cycle-notice');
 await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('HOTELS-5');await page.getByRole('button',{name:'Раскрыть HOTELS-5',exact:true}).click();await resetScroll(700,16000);await shot('13-vertical-scroll');
 await page.unroute('**/api/dataset');
 const replacement=structuredClone(response);replacement.dataset.id='expanded-status-small';replacement.dataset.epics=replacement.dataset.epics.filter(e=>e.summary.key==='HOTELS-2');delete replacement.dataset.hierarchy;
 await page.route('**/api/dataset',route=>route.fulfill({json:replacement}));await page.reload({waitUntil:'networkidle'});
 assert.equal(await page.locator('.epic-row').count(),1);assert.equal(await page.locator('.timeline-header .metric-grid button').count(),5);await shot('14-replacement-dataset');
 checks.push('Цикл, неизвестная дочерняя история, вертикальная прокрутка и новый набор с меньшим составом колонок (отдельные синтетические ответы API)');
 await page.unroute('**/api/dataset');
 assert.deepEqual(errors,[]);
 await writeFile(`${out}/browser-report.json`,JSON.stringify({status:'passed',browser:'installed Google Chrome, isolated temporary profile',viewport:[1440,1100],narrowViewport:[800,1000],synthetic:true,checks,errors},null,2));
 console.log(JSON.stringify({status:'passed',checks:checks.length,errors}));
} catch(error) {
 await shot('failure');await writeFile(`${out}/browser-failure.json`,JSON.stringify({status:'failed',checks,errors,error:String(error)},null,2));console.error(String(error));process.exitCode=1;
} finally {await browser.close();}
