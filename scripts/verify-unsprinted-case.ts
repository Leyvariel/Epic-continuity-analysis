// Read-only acceptance check against the user's existing saved inputs. No Jira requests.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildJiraDataset} from '../server/jira/dataset';
const file='.local-data/dataset.json',raw=await readFile(file),cached=JSON.parse(raw.toString());
const dataset=buildJiraDataset(cached.inputs,cached.dataset.savedAt,cached.dataset.id),id=dataset.hierarchy!.roots['HOTELS-13142'];assert.ok(id);
const row=dataset.sprintAnalysis!.rows[id];assert.ok(row.gaps.some(g=>g.start==='2026-08-18T12:12:23.407Z'&&g.end==='2026-08-25T09:22:33.000Z'));
const activity=row.activity!.find(a=>a.taskKey==='TEXT-1314');assert.ok(activity);assert.equal(activity.intervals[0].start,'2026-07-28T08:21:40.000Z');assert.equal(activity.intervals[0].end,'2026-07-28T15:28:07.000Z');
assert.notEqual(row.focus!.totalMs,null);assert.deepEqual(await readFile(file),raw);
const report={key:'HOTELS-13142',asOf:dataset.asOf,cacheSha256:createHash('sha256').update(raw).digest('hex'),gaps:row.gaps,focus:row.focus,activity,status:'passed',cacheUnchanged:true};
await writeFile('docs/sdd/changes/archive/2026/LOCAL-20261109-01-unsprinted-task-activity/evidence/hotels-case.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:'passed',gaps:row.gaps,totalDays:row.focus!.totalMs!/86400000}));
