// Real Chrome visual and interaction checks against the isolated fixture; GET only on the main app.
import path from 'node:path';
import os from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.FOCUS_PLAYWRIGHT_MODULE??path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const out=path.resolve(process.env.COLUMNS_EVIDENCE_DIR??'docs/sdd/changes/archive/2026/LOCAL-20261103-01-hypothesis-status-columns/evidence/visual');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.FOCUS_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const shot=async name=>page.screenshot({path:path.join(out,`${name}.png`),fullPage:false});
const headings=()=>page.locator('.timeline-header button[aria-label^="Сортировать:"]').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label').replace('Сортировать: ','')));
const scroll=async(left=0,top=0)=>page.locator('.timeline-scroll').evaluate((el,{left,top})=>{el.scrollLeft=left;el.scrollTop=top;},{left,top});
const filter=async key=>{await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill(key);await scroll();};
const expand=async()=>{await page.getByRole('button',{name:'Раскрыть A-1',exact:true}).click();await page.getByRole('button',{name:'Раскрыть A-2',exact:true}).click();};
const alignment=async()=>{
 const xs=await page.locator('.calendar-header, .epic-row .row-calendar, .related-row .row-calendar').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().x));
 assert.ok(xs.every(x=>Math.abs(x-xs[0])<1),JSON.stringify(xs));
 const header=await page.getByRole('button',{name:'Сортировать: Реализация',exact:true}).boundingBox();
 const cell=await page.locator('.epic-row [data-metric="implementation"]').first().boundingBox();
 assert.ok(Math.abs(header.x-cell.x)<1);
};
try{
 await page.goto('http://127.0.0.1:4334/',{waitUntil:'networkidle'});
 const base=await headings();assert.deepEqual(base,['Time to Market','TTM без флага','Без работы','Реализация']);
 assert.equal(await page.locator('.epic-row[data-issue-key="A-1"] [data-metric="sprintFocus"]').textContent(),'14,00');
 await filter('A-1');const range=await page.locator('.calendar-header').getAttribute('style');await expand();
 assert.deepEqual(await headings(),base);assert.equal(await page.locator('.related-row .metric, .related-row [data-metric], .related-row .left-area [tabindex]').count(),0);
 assert.ok(await page.locator('.related-segment').count()>14);
 for(const key of ['A-1','A-2','A-3'])assert.equal(await page.locator(`[data-issue-key="${key}"] .sprint-segment`).count(),1);
 assert.equal(await page.locator('.sprint-empty.sprint-segment,.sprint-unknown.sprint-segment').count(),0);
 assert.equal(await page.locator('.calendar-header').getAttribute('style'),range);
 await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await alignment();await shot('01-children-bars-only');
 for(const [label,scale] of [['День',26],['Неделя',8],['Месяц',3]]){
  await page.getByRole('button',{name:label,exact:true}).click();
  assert.equal(await page.locator('[data-issue-key="A-3"] .sprint-segment').evaluate(el=>parseFloat(el.style.width)),7*scale);
  await scroll(400);await alignment();await shot(`02-scale-${scale}`);
 }
 await page.getByRole('button',{name:'Свернуть A-1',exact:true}).click();assert.equal(await page.locator('.related-row').count(),0);assert.deepEqual(await headings(),base);
 checks.push('Only source columns; children retain status and work sprint bars in day/week/month; collapse, alignment and axis unchanged');
 const alternative=await (await page.request.get('http://127.0.0.1:4334/api/alternative-fixture')).json();
 await page.route('**/api/dataset',route=>route.fulfill({json:alternative}));await page.reload({waitUntil:'networkidle'});
 const expected=['Time to Market','TTM без флага','Без работы','Подготовка','Валидация','Скоринг','Реализация','Тестирование эпика','Релиз','Эксперимент'];
 assert.deepEqual(await headings(),expected);
 for(const id of ['preparation','validation','scoring','epic-testing','release'])assert.equal(await page.locator(`.epic-row[data-issue-key="A-1"] [data-metric="${id}"]`).textContent(),'1,00');
 await filter('A-4');assert.deepEqual(await headings(),expected);assert.equal(await page.locator('.epic-row [data-metric="release"]').textContent(),'0,00');
 await page.getByLabel('Сортировка',{exact:true}).selectOption('release');assert.deepEqual(await headings(),expected);
 await filter('A-1');await expand();await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await shot('03-root-alternatives');await scroll(620);await alignment();await shot('04-root-alternatives-scrolled');
 checks.push('All five root alternatives appear in order with correct numbers; filtering and sorting preserve columns; child cells remain absent');
 await page.setViewportSize({width:800,height:1000});await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await scroll();await shot('05-narrow-table');await scroll(900,160);await shot('06-narrow-calendar');
 assert.ok(await page.locator('.timeline-scroll').evaluate(el=>el.scrollWidth>el.clientWidth));
 checks.push('800px viewport: numeric columns and calendar accessible by horizontal and vertical scroll');
 await page.setViewportSize({width:1440,height:1050});await scroll();
 await page.getByRole('button',{name:'Правила расчёта',exact:true}).click();assert.match(await page.getByRole('dialog').textContent(),/Статусы дочерних элементов не добавляют колонок/);assert.match(await page.getByRole('dialog').textContent(),/Числовая часть этих строк остаётся пустой/);await page.keyboard.press('Escape');
 await page.unroute('**/api/dataset');await page.goto('http://127.0.0.1:4317/',{waitUntil:'networkidle'});
 await page.locator('.epic-row').first().waitFor();
 // Private live dataset is inspected, but not copied into committed evidence or modified.
 const liveCount=await page.locator('.epic-row').count();assert.ok(liveCount>0);
 const toggles=page.locator('.epic-row .root-disclosure:not([disabled])');
 if(await toggles.count())await toggles.first().click();
 assert.equal(await page.locator('.related-row [data-metric]').count(),0);
 checks.push('Main app 4317: saved dataset loads, updated bundle is served, child numeric cells absent; no import or cache mutation');
 assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'browser-report.json'),JSON.stringify({status:'passed',browser:'installed Google Chrome, isolated temporary profile',checks,errors},null,2));console.log(JSON.stringify({status:'passed',checks:checks.length,errors}));
}catch(e){await shot('failure');await writeFile(path.join(out,'browser-failure.json'),JSON.stringify({checks,errors,error:String(e)},null,2));console.error(e);process.exitCode=1;}
finally{await browser.close();}
