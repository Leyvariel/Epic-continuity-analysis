// Real Chrome acceptance against the isolated demo from verify-sprint-focus-demo.ts.
import path from 'node:path';
import os from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.FOCUS_PLAYWRIGHT_MODULE??path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const out=path.resolve(process.env.FOCUS_EVIDENCE_DIR??'docs/sdd/changes/archive/2026/LOCAL-20261102-01-sprint-focus/evidence/visual');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.FOCUS_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const shot=async(name,fullPage=true)=>page.screenshot({path:path.join(out,`${name}.png`),fullPage});
const scroll=async(left=0,top=0)=>page.locator('.timeline-scroll').evaluate((el,{left,top})=>{el.scrollLeft=left;el.scrollTop=top;},{left,top});
const filter=async key=>{await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill(key);await scroll();};
const cell=key=>page.locator(`.epic-row[data-issue-key="${key}"] [data-metric="sprintFocus"]`);
try {
 await page.goto('http://127.0.0.1:4333/',{waitUntil:'networkidle'});await page.locator('.epic-row').first().waitFor();
 assert.equal(await page.locator('.epic-row').count(),6);
 for(const [key,value] of [['FOCUS-101','14,00'],['FOCUS-201','0,00'],['FOCUS-301','15,00предв.'],['FOCUS-401','—'],['FOCUS-501','—'],['FOCUS-601','21,00']])assert.equal(await cell(key).textContent(),value,key);
 assert.equal(await page.locator('.sprint-empty.sprint-segment, .sprint-unknown.sprint-segment, .sprint-active-empty.sprint-segment').count(),0);
 await shot('01-wide-table');checks.push('Six numerical states: 14, 0, provisional 15, unknown, not started, 21; no nonworking sprint buttons');
 await page.getByLabel('Сортировка',{exact:true}).selectOption('sprintFocus');
 const keys=()=>page.locator('.epic-row').evaluateAll(rows=>rows.map(r=>r.dataset.issueKey));
 assert.deepEqual(await keys(),['FOCUS-601','FOCUS-301','FOCUS-101','FOCUS-201','FOCUS-401','FOCUS-501']);
 await page.getByLabel('Изменить направление сортировки',{exact:true}).click();assert.deepEqual(await keys(),['FOCUS-201','FOCUS-101','FOCUS-301','FOCUS-601','FOCUS-401','FOCUS-501']);checks.push('Both directions: numeric values shared with cells, null last');
 await filter('FOCUS-101');const range=await page.locator('.calendar-header').getAttribute('style');
 await page.getByRole('button',{name:'Раскрыть FOCUS-101',exact:true}).click();await page.getByRole('button',{name:'Раскрыть FOCUS-102',exact:true}).click();
 assert.equal(await page.locator('.related-row [data-metric]').count(),0);
 for(const key of ['FOCUS-101','FOCUS-102','FOCUS-103'])assert.equal(await page.locator(`[data-issue-key="${key}"] .sprint-segment`).count(),1);
 assert.equal(await page.locator('.calendar-header').getAttribute('style'),range);
 for(const [label,scale] of [['День',26],['Неделя',8],['Месяц',3]]){
  await page.getByRole('button',{name:label,exact:true}).click();assert.equal(await page.locator('[data-issue-key="FOCUS-103"] .sprint-segment').evaluate(el=>parseFloat(el.style.width)),7*scale);
  await scroll(500);await shot(`02-expanded-${scale}`);
 }
 const header=await page.getByRole('button',{name:'Сортировать: Без работы',exact:true}).boundingBox(),rootCell=await cell('FOCUS-101').boundingBox();assert.ok(Math.abs(header.x-rootCell.x)<1);
 checks.push('Two levels, whole working sprints, stable axis, day/week/month, metric alignment and horizontal scroll');
 await scroll();await cell('FOCUS-101').click();const detail=page.locator('.sprint-focus-details');await detail.scrollIntoViewIfNeeded();
 assert.match(await detail.textContent(),/Включение задачи без работы устраняет прежнюю тёмную отметку/);assert.equal(await page.locator('.epic-row .epic-sprint-gap').count(),0);
 await detail.getByText('Циклы реализации (1)',{exact:true}).click();await detail.getByText('Спринты и подтверждения работы',{exact:true}).click();await shot('03-focus-details');
 assert.match(await detail.textContent(),/FOCUS-103/);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await cell('FOCUS-101').evaluate(el=>document.activeElement===el),true);
 checks.push('Details include dates, task links and distinction from membership gaps; Escape restores focus');
 await filter('FOCUS-401');await page.getByRole('button',{name:'Раскрыть FOCUS-401',exact:true}).click();await page.getByRole('button',{name:'Раскрыть FOCUS-402',exact:true}).click();
 assert.equal(await page.locator('.sprint-segment').count(),0);assert.ok(await page.locator('.sprint-warnings').count()>0);await page.locator('.epic-row .sprint-warnings summary').click();await shot('04-unknown-hidden');checks.push('All sprints hidden: diagnostics remain accessible');
 await filter('FOCUS-601');assert.ok(await page.locator('.epic-sprint-gap').count()>0);await shot('05-old-gaps');
 await filter('FOCUS-301');await cell('FOCUS-301').click();await page.locator('.sprint-focus-details').scrollIntoViewIfNeeded();assert.match(await detail.textContent(),/предварительно/);await shot('06-provisional');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Правила расчёта',exact:true}).click();await page.getByRole('heading',{name:'Время без работы по спринтам',exact:true}).scrollIntoViewIfNeeded();await shot('07-rules');await page.locator('.overlay').click({position:{x:8,y:8}});assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByLabel('Источник длительностей',{exact:true}).selectOption('excel');assert.equal(await page.locator('[data-metric="sprintFocus"]').count(),0);assert.equal(await page.getByLabel('Сортировка',{exact:true}).inputValue(),'ttm');assert.equal(await page.locator('.epic-row [data-metric="ttm"]').textContent(),'42,00');await shot('08-excel');checks.push('Provisional label, rules, overlay close, Excel source preserves 42 and resets unavailable sort');
 await page.getByLabel('Источник длительностей',{exact:true}).selectOption('history');await filter('');await page.setViewportSize({width:800,height:1000});await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await shot('09-narrow-table',false);await scroll(1600,0);await shot('10-narrow-calendar',false);await scroll(500,700);await shot('11-vertical-scroll',false);
 assert.ok(await page.locator('.timeline-scroll').evaluate(el=>el.scrollWidth>el.clientWidth));checks.push('800px viewport: horizontal and vertical scrolling');
 await page.setViewportSize({width:1440,height:1050});await filter('FOCUS-501');
 await page.getByRole('button',{name:'Раскрыть FOCUS-501',exact:true}).click();await page.getByRole('button',{name:'Раскрыть FOCUS-502',exact:true}).click();
 const beforeCount=await page.locator('.related-row').count();await page.getByRole('button',{name:'Показать ещё',exact:true}).click();assert.ok(await page.locator('.related-row').count()>beforeCount);
 await scroll(1500,15000);await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await shot('13-paginated',false);checks.push('Wide status columns, 200-row pagination and deep vertical scroll');
 // Missing inputs on an independent response exercise compatibility without touching any saved dataset.
 const response=await (await page.request.get('http://127.0.0.1:4333/api/dataset')).json();delete response.dataset.sprintAnalysis;response.dataset.id='old-without-sprints';
 await page.route('**/api/dataset',route=>route.fulfill({json:response}));await page.reload({waitUntil:'networkidle'});assert.equal(await cell('FOCUS-101').textContent(),'—');assert.match(await cell('FOCUS-101').getAttribute('title'),/Спринты не загружены/);await shot('12-old-cache');checks.push('Old dataset without sprint inputs has an explanatory dash');
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'browser-report.json'),JSON.stringify({status:'passed',browser:'installed Google Chrome, isolated temporary profile',checks,errors},null,2));console.log(JSON.stringify({status:'passed',checks:checks.length,errors}));
} catch(e){await shot('failure');await writeFile(path.join(out,'browser-failure.json'),JSON.stringify({checks,errors,error:String(e)},null,2));console.error(e);process.exitCode=1;}
finally {await browser.close();}
