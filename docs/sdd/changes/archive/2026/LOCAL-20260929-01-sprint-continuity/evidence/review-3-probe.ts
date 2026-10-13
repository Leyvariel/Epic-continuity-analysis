// Проверка границы существующего помощника, не тест будущей аналитики спринтов.
import assert from 'node:assert/strict';
import { eligibleHierarchyIds } from '../../../../../../../shared/hierarchy-view';
import { hierarchySchema } from '../../../../../../../server/hierarchy-schema';
import type { HierarchyInput, HierarchyNodeInput } from '../../../../../../../shared/hierarchy';

const node = (id: string, type: HierarchyNodeInput['type'], branchCoverage: HierarchyNodeInput['branchCoverage'] = 'complete'): HierarchyNodeInput => ({
  id, key: `${id}-1`, title: id, type, resolution: type === 'unknown' ? null : '',
  created: '2026-09-01T00:00:00Z', currentStatus: '', statusCategories: {},
  historyCoverage: 'unavailable', branchCoverage, warnings: [],
});
const graph: HierarchyInput = {
  version: 1, asOf: '2026-09-29T00:00:00Z', roots: { 'R-1': 'R' },
  nodes: { R: node('R', 'epic', 'partial'), T: node('T', 'task'), X: node('X', 'unknown', 'unavailable') },
  edges: [{ parent: 'R', child: 'T' }, { parent: 'R', child: 'X' }], coverage: 'partial', warnings: [],
};
assert(hierarchySchema.safeParse(graph).success);
const eligibleIds = [...eligibleHierarchyIds(graph)].sort();
assert.deepEqual(eligibleIds, ['R', 'T']);
const missingBranchGraph = structuredClone(graph);
delete missingBranchGraph.nodes.X;
missingBranchGraph.edges = [{ parent: 'R', child: 'T' }];
assert(hierarchySchema.safeParse(missingBranchGraph).success);
assert.deepEqual([...eligibleHierarchyIds(missingBranchGraph)].sort(), eligibleIds);
console.log(JSON.stringify({
  scope: 'Синтетический граф; действующая схема и помощник отбора. Сетевых запросов и записи рабочего кэша нет.',
  unknownNode: { schemaValid: true, graphCoverage: graph.coverage, eligibleIds, omittedId: 'X' },
  missingBranch: { schemaValid: true, rootBranchCoverage: missingBranchGraph.nodes.R.branchCoverage, eligibleIds },
  implication: 'Список допустимых ID сам по себе не доказывает полноту потомков. Будущий расчёт должен отдельно учитывать неизвестные узлы и неполные ветки каждого корня.',
}, null, 2));
