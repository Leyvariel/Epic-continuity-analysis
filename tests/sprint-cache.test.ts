import {sprintDatasetInputs} from './sprint-dataset-fixture';
import {it,expect,vi} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CacheStore} from '../server/cache';
import {DatasetService} from '../server/service';
import {buildJiraDataset} from '../server/jira/dataset';
import {jiraInputsSchema} from '../server/jira/cache-schema';
import type {JiraInputs,HistorySnapshot} from '../shared/contracts';
import {fixture,at} from './sprint-fixtures';
it('T007: supplement persists, restarts through same builder without Jira or changes to old metrics',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sprint-cache-'));
 try{
 const inputs=jiraInputsSchema.parse(sprintDatasetInputs());expect(inputs.sprintInputs).toBeDefined();
 const withSprints=buildJiraDataset(inputs,at(30),'id');expect(withSprints.sprintAnalysis?.rows['1'].segments).toHaveLength(3);
 const {sprintInputs,...old}=inputs;expect(buildJiraDataset(old,at(30),'id').epics).toEqual(withSprints.epics);
 const store=new CacheStore(dir);await store.write({schemaVersion:3,calculationProfile:'jira-v3',inputs,dataset:withSprints});
 const factory=vi.fn();const service=new DatasetService(store,()=>at(30),factory);await service.initialize();expect(service.getDataset()).toEqual(withSprints);expect(factory).not.toHaveBeenCalled();
 const raw=JSON.parse(await readFile(path.join(dir,'dataset.json'),'utf8'));raw.inputs.sprintInputs.version=2;const bad=JSON.stringify(raw);await writeFile(path.join(dir,'dataset.json'),bad);
 await expect(store.read()).rejects.toMatchObject({code:'CACHE_INVALID'});expect(await readFile(path.join(dir,'dataset.json'),'utf8')).toBe(bad);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('T007: links and cutoff must match; absent supplement remains valid',()=>{
 const input=sprintDatasetInputs();input.sprintInputs!.tasks['3'].subtaskIds=['999'];expect(jiraInputsSchema.safeParse(input).success).toBe(false);
 input.sprintInputs=fixture().input;input.sprintInputs.asOf=at(29);expect(jiraInputsSchema.safeParse(input).success).toBe(false);
 delete input.sprintInputs;expect(jiraInputsSchema.safeParse(input).success).toBe(true);expect(buildJiraDataset(input,at(30)).sprintAnalysis).toBeUndefined();
});
